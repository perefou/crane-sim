const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

// THIS IS THE MAGIC LINE! It tells the server it is allowed to serve your .obj and .mtl files.
app.use(express.static(__dirname));

// Serve the index.html file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Multiplayer WebSocket Logic
io.on('connection', (socket) => {
  console.log('A user connected!');

  // When the Host phone sends physics data, broadcast it to Viewer phones
  socket.on('stateUpdate', (data) => {
    socket.broadcast.emit('stateUpdate', data);
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
