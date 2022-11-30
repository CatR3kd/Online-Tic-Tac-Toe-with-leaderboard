socket = io();
let username,
  userid
let leaderboard;
let match;
let opponent;

socket.on('loggedIn', function(newUsername, newId) {
  username = newUsername;
  userid = newId

  document.getElementById('loginContainer').style.visibility = 'hidden';
  document.getElementById('content').style.visibility = 'visible';
});

socket.on('leaderboardUpdate', function(newLeaderboard) {
  leaderboard = newLeaderboard;

  console.log('New leaderboard:');
  console.log(leaderboard);

  updateLeaderboard();
});

socket.on('joinedMatch', function(newMatch) {
  match = newMatch;

  const opponentElem = document.getElementById('opponent');
	const itemElem = document.getElementById('itemType');
  opponent = (match.players[0].username != username) ? match.players[0].username : match.players[1].username;
	item = (match.players[0].username != username) ? 'X' : 'O';
  opponentElem.innerText = `Opponent: ${opponent}`;
  opponentElem.style.visibility = 'visible';
	itemElem.innerText = `You are: ${item}`;
  itemElem.style.visibility = 'visible';

  document.getElementById('waitingContainer').style.visibility = 'hidden';
  document.getElementById('newGame').style.visibility = 'hidden';
  updateBoard(match.board);
  displayTurn();

  console.log('Match joined:');
  console.log(match);
});

socket.on('matchUpdate', function(newMatch) {
  match = newMatch;

  updateBoard(match.board);
  displayTurn();

  console.log('Match updated:');
  console.log(match);
});

socket.on('gameWon', function(winObj) {
  match = winObj.match;

  updateBoard(match.board);
  document.getElementById('turn').innerText = `Winner: ${winObj.winner}!`;
  document.getElementById('newGame').style.visibility = 'visible';

  console.log('Game finished:');
  console.log(winObj);
});

socket.on('catsGame', function(newMatch) {
  match = newMatch;

  updateBoard(match.board);
  document.getElementById('turn').innerText = 'Cat\'s game.';
  document.getElementById('newGame').style.visibility = 'visible';

  console.log('Cat\'s game:');
  console.log(null);
});

socket.on('opponentDisconnect', function() {
  document.getElementById('turn').innerText = 'Opponent disconnected.';
  document.getElementById('newGame').style.visibility = 'visible';
  document.getElementById('opponent').style.visibility = 'hidden';

  console.log('Opponent disconnected.');
});

socket.on('opponentTimedOut', function() {
  document.getElementById('turn').innerText = 'Opponent ran out of time.';
  document.getElementById('newGame').style.visibility = 'visible';
  document.getElementById('opponent').style.visibility = 'hidden';

  console.log('Opponent ran out of time.');
});

socket.on('timedOut', function() {
  document.getElementById('turn').innerText = 'You ran out of time!';
  document.getElementById('newGame').style.visibility = 'visible';
  document.getElementById('opponent').style.visibility = 'hidden';

  console.log('You ran out of time!');
});

socket.on('chatMsg', function(msgObj) {
  newChat(msgObj);
});

socket.on('score', function(score) {
  document.getElementById('score').innerText = `Your Score: ${score}`;
});

socket.on('kick', function() {
  window.location.reload();
});

function updateBoard(board) {
  const squares = document.getElementById('gameBoard').children;

  for (let square in squares) {
    squares[square].innerText = board[square];
  }
}

function playTurn(square) {
  if (!match) return;
  if (match.players[match.turn].username != username) return;
  if (match.board[square] != '') return;

  const move = {
    match: match,
    square: square
  }

  socket.emit('playTurn', move);
}

function displayTurn() {
  let text = `${match.players[match.turn].username}'s turn.`;

  if (match.players[match.turn].username == username) text = 'Your turn!';

  document.getElementById('turn').innerText = text;
}

function updateLeaderboard() {
  if (leaderboard.length < 1) return;

  const places = document.getElementById('leaderboard').getElementsByTagName('li');

  for (let place in places) {
    const player = leaderboard[place];
    if (player) {
      places[place].innerText = `${player.username}: ${formatNumber(player.score)}`;
    }
  }
}

function formatNumber(number) {
  if (number) {
    return (number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  } else {
    return (number);
  }
}

document.onclick = function(event) {
  if (event.isTrusted == false) window.reload();
}

function joinQueue() {
  document.getElementById('waitingContainer').style.visibility = 'visible';
  document.getElementById('turn').innerText = '';
  document.getElementById('opponent').style.visibility = 'hidden';
  document.getElementById('newGame').style.visibility = 'hidden';

  socket.emit('joinQueue');
}

function sendChat() {
  const input = document.getElementById('chatMessage');
  const msg = input.value;

  if ((msg.length < 1) || (msg.length > 99)) return;

  socket.emit('sendChat', msg);
  input.value = '';
}

function newChat(msgObj) {
  console.log(msgObj)
  const sender = msgObj.sender;
  const badgeColor = msgObj.badgeColor;

  const messages = document.getElementById('chat').children;

  if (document.getElementById('chat').offsetHeight > 130) {
    (messages[0]).remove();
  }

  let li = document.createElement('li')
  let badge = document.createElement('span')
  let msg = document.createElement('msg')


  badge.innerText = `${sender}: `;
  badge.style.color = msgObj.badgeColor;

  msg.innerText = msgObj.msg;
  li.appendChild(badge);
  li.appendChild(msg);

  document.getElementById('chat').appendChild(li);
}

// Send on enter

document.getElementById('chatMessage').addEventListener('keyup', function(event) {
  if (event.keyCode === 13) {
    event.preventDefault();
    sendChat();
  }
});

// accordion
var acc = document.getElementsByClassName("accordion");
for (var i = 0; i < acc.length; i++) {
  acc[i].addEventListener("click", function() {
    this.classList.toggle("active");
    var panel = this.nextElementSibling;
    if (panel.style.display === "block") {
      panel.style.display = "none";
    } else {
      panel.style.display = "block";
    }
  });
  acc[i].classList.toggle("active");
  acc[i].nextElementSibling.style.display = "block";
} 