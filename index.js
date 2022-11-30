const express = require('express');
const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const Database = require("replitdb-client");
const db = new Database();
const fs = require('fs');
const Filter = require('bad-words');
filter = new Filter();
const { RateLimiterMemory } = require('rate-limiter-flexible');

// Server

http.listen(8000, () => {
  console.log('Server online');
});

app.use(express.static(path.join(__dirname + '/Public')));

// Ratelimit for chat

const sendChatRateLimit = new RateLimiterMemory({
  points: 4,
  duration: 2
});

// Leaderboard

getTopTen().then(topTen => {
  io.emit('leaderboardUpdate', topTen);
});

// Queue, matches, and board

const queue = new Map();
const matches = new Map();
const playing = new Map();
const usersOnline = new Map();

class Match {
  constructor(id, players, board) {
    this.id = id;
    this.players = players;
    this.board = [
      '', '', '',
      '', '', '',
      '', '', ''
    ];
    this.turn = Math.round(Math.random()); // Random 0 or 1
  }
}

// Socket.io

io.on('connection', (socket) => {
	const userid = socket.handshake.headers['x-replit-user-id']
  const username = socket.handshake.headers['x-replit-user-name'];

  if((!username) || queue.has(username) || playing.has(socket.id)){
    socket.disconnect();
  } else {
    socket.emit('loggedIn', username, userid);
    createUser(username);
    sendScore(username, socket.id);
  
    const user = {
      username: username,
      id: socket.id
    };
    queue.set(username, user);
    usersOnline.set(username, socket.id);

    getTopTen().then(topTen => {
      socket.emit('leaderboardUpdate', topTen);
    });
    
    createMatches();
  }

  socket.on('joinQueue', function() {
    const username = socket.handshake.headers['x-replit-user-name'];
    
    if((playing.has(socket.id)) || (queue.has(username))) return;
    
    const user = {
      username: username,
      id: socket.id
    };
    queue.set(username, user);
    
    createMatches();
  });

  socket.on('sendChat', async function(msg) {
    const username = socket.handshake.headers['x-replit-user-name'];
		const userid = socket.handshake.headers['x-replit-user-id']
    
    try {
      await sendChatRateLimit.consume(username);
      
      sendChat(username, msg, userid);
    } catch(rejRes) {
      console.log(rejRes)
      // Ratelimited
      const chatObj = {
        sender: 'System',
        msg: 'Slow down!',
        badgeColor: 'red'
      }
      
      socket.emit('chatMsg', chatObj);
    }
  });

  socket.on('playTurn', function(move) {
    // Make sure the match exists
    if((!(move.match.id)) || (!(matches.has(move.match.id)))) return;
    
    const match = matches.get(move.match.id);

    // Make sure it is the player's turn
    if(match.players[match.turn].id != socket.id) return;
    
    // Make sure the move is a one digit number 0-8 and isn't taken
    if(!(Number.isInteger(move.square))) return;
    if((move.square > 8) || (move.square < 0)) return;
    if(((move.square).toString()).length != 1) return;
    if(match.board[move.square] != '') return;
    
    const player = match.players[match.turn];
    const symbol = (match.turn == 0)? 'O' : 'X';
    
    // Play the move
    match.board[move.square] = symbol;
    match.turn = (match.turn == 0)? 1 : 0;
    
    // Check for wins and emit results
    const players = match.players;
    const winner = checkForWin(match.board, players);
    
    if(winner != ''){
      const winObj = {
        winner: winner,
        match: match
      }

      const loser = (winner == players[0].username)? players[1].username : players[0].username;
    
      io.to(players[0].id).emit('gameWon', winObj);
      io.to(players[1].id).emit('gameWon', winObj);

      incrementUser(winner, 1);
      incrementUser(loser, -1);

      sendScore(players[0].username, players[0].id);
      sendScore(players[1].username, players[1].id);
      

      playing.delete(players[0].id);
      playing.delete(players[1].id);
      
      matches.delete(match.id);
      return;
    }
    
    // Check for Cat's Game

    const catsGame = checkForFullBoard(match.board);

    if(catsGame == true){
      io.to(players[0].id).emit('catsGame', match);
      io.to(players[1].id).emit('catsGame', match);

      playing.delete(players[0].id);
      playing.delete(players[1].id);
      
      matches.delete(match.id);
      return;
    }
    
    io.to(players[0].id).emit('matchUpdate', match);
    io.to(players[1].id).emit('matchUpdate', match);

    // Set timeout for turn length
    timeOut(match);
  });

  socket.on('disconnect', function() {
    const username = socket.handshake.headers['x-replit-user-name'];
    
    if(queue.has(username)) queue.delete(username);
    if(usersOnline.has(username)) usersOnline.delete(username);
    
    if(playing.has(socket.id)){
      const matchID = playing.get(socket.id);
      const match = matches.get(matchID);
      const players = match.players;
      const disconnectedPlayer = (players[0].username != username)? players[1] : players[0];
      const otherPlayer = (players[0].username == username)? players[1] : players[0];
      
      playing.delete(socket.id);
      playing.delete(otherPlayer.id);
      matches.delete(matchID);
      
      incrementUser(disconnectedPlayer.username, -2);
      sendScore(otherPlayer.username, otherPlayer.id);
      
      io.to(otherPlayer.id).emit('opponentDisconnect');
    }
  });
});

// Match creation

function createMatches(){ 
  const queueArray = [...queue.values()];
  
  if(queueArray.length < 2) return;

  queueArray
    .map(value => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
                           
  let pairs = [];

  queueArray.reduce(function(result, value, index, array) {
    if (index % 2 === 0) pairs.push(array.slice(index, index + 2));
  }, []);

  for(let pair in pairs){
    if(pairs[pair].length < 2){
      pairs.splice(pair, 1)
    } else {
      const matchID = (performance.now().toString(36)+Math.random().toString(36)).replace(/\./g,'');
      const players = pairs[pair];
      const match = new Match(matchID, [...players]);

      queue.delete(pairs[pair][0].username);
      queue.delete(pairs[pair][1].username);

      playing.set(pairs[pair][0].id, matchID);
      playing.set(pairs[pair][1].id, matchID);

      matches.set(matchID, match);

      io.to(players[0].id).emit('joinedMatch', match);
      io.to(players[1].id).emit('joinedMatch', match);
    }
  }
}

// Timeout

async function timeOut(match){
  setTimeout(function(){
    const newMatch = matches.get(match.id);
    
    if(newMatch == match){
      const players = match.players;
      const otherPlayer = (match.turn == 0)? 1 : 0;
      
      io.to(players[match.turn].id).emit('timedOut', match);
      io.to(players[otherPlayer].id).emit('opponentTimedOut', match);

      incrementUser(players[otherPlayer].username, -2);
      sendScore(players[otherPlayer].username, players[otherPlayer].id);

      playing.delete(players[0].id);
      playing.delete(players[1].id);
      
      matches.delete(match.id);
    }
  }, 60_000);
}

// Game

function checkForWin(board, players){
  /* Board format
  0 1 2
  3 4 5
  6 7 8
  */
  let winner = '';

  // Horizontal
  if(board[0] == board[1] && board[0] == board[2] && board[0] != '') winner = board[0];
  if(board[3] == board[4] && board[3] == board[5] && board[3] != '') winner = board[3];
  if(board[6] == board[7] && board[6] == board[8] && board[6] != '') winner = board[6];

  // Vertical
  if(board[0] == board[3] && board[0] == board[6] && board[0] != '') winner = board[0];
  if(board[1] == board[4] && board[1] == board[7] && board[1] != '') winner = board[1];
  if(board[2] == board[5] && board[2] == board[8] && board[2] != '') winner = board[2];

  // Diagonal
  if(board[0] == board[4] && board[0] == board[8] && board[0] != '') winner = board[0];
  if(board[2] == board[4] && board[2] == board[6] && board[2] != '') winner = board[2];
  
  if(winner != ''){
    const playerIndex = (winner == 'O')? 0 : 1;
    winner = players[playerIndex].username;
  }
  return winner;
}

function checkForFullBoard(board){
  let full = true;
  
  for(let square of board){
    if(square == '') full = false;
  }

  return full;
}

// Leaderboard

async function createUser(username){
  const user = await db.get(username);
  if(user != undefined) return;
  db.set(username, 0);

  // Incrementing the user also sorts the leaderboard, B)
  incrementUser(username, 0);
}

async function incrementUser(username, increment){
  // Update DB
  const oldScore = await db.get(username);
  const newScore = oldScore + increment;
  await db.set(username, newScore);

  const topUsers = JSON.parse(await fs.readFileSync('leaderboard.json'));

  // Determine if the user is on the leaderboard, and remove the old one if so
  for(let user in topUsers){
    if(topUsers[user].username == username) topUsers.splice(user, 1);
  }

  // Put user on leaderboard and sort
  const newUserObj = {
    username: username,
    score: newScore
  };

  topUsers.push(newUserObj);

  topUsers.sort(function(a, b) {
    return(b.score - a.score);
  });

  // Delete extra values
  while(topUsers.length > 10){
    topUsers.pop();
  }

  // Save to JSON and emit
  fs.writeFileSync('leaderboard.json', JSON.stringify(topUsers));
  io.emit('leaderboardUpdate', topUsers);
}

async function getTopTen(){
  // If the leaderboard is empty, regenerate it
  if(isEmpty('leaderboard.json') != false) return await sortLeaderboard();
  
  const topTen = await fs.readFileSync('leaderboard.json');
  return JSON.parse(topTen);
}

async function sortLeaderboard(){
  var users = await db.getAll();
  var topUsers = [];
  
  Object.keys(users).forEach(function(key){
    const userObj = {
      username: key,
      score: users[key]
    }
    
    if(topUsers.length < 10){
      topUsers.push(userObj);
      topUsers.sort(function(a, b) {
        return(b.score - a.score);
      });
    } else if(user.score > topUsers[9].score){
      topUsers[9] = userObj;
      topUsers.sort(function(a, b) {
        return(b.score - a.score);
      });
    }
  });
  
  fs.writeFileSync('leaderboard.json', JSON.stringify(topUsers));
  
  return topUsers;
}

function isEmpty(path) {
  const file = fs.readFileSync(path);
  for(var key in file) {
    if(file.hasOwnProperty(key) && Object.keys(JSON.parse(file)).length !== 0)
      return false;
    }
  return true;
}

// Send score updates

async function sendScore(username, socketID){
  const userObj = await db.get(username);
  if(userObj == undefined) return;
  
  io.to(socketID).emit('score', userObj);
}

// Chat & Commands

function sendChat(username, msg, userid){
  if((msg.length < 1) || (msg.length > 99)) return;

  if(msg.charAt(0) == '/') return chatCommand(username, msg);

  let badgeColor = '#000000';
  if(username == 'CatR3kd') badgeColor = '#54b382';

  const msgObj = {
    sender: username,
		senderid: userid,
    msg: filter.clean(msg),
    badgeColor: badgeColor
  }
    
  io.emit('chatMsg', msgObj);
}

function chatCommand(username, msg){
  if(username != 'CatR3kd') return;
  
  const command = msg.split(' ')[0].substring(1);
  let args = msg.split(' ');
  args.shift();

  if(command == 'kick'){
    if(args.length != 1) return;
    if(!(usersOnline.has(args[0]))) return;

    const target = usersOnline.get(args[0]);
    io.to(target).emit('kick');
  }
}