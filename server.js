const express = require('express');
const path = require('path');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { transports: ['websocket'] });

// Only the public/ folder is served (index.html, rig.obj, rig.mtl), not server.js or package.json.
app.use(express.static(path.join(__dirname, 'public')));

// room name -> host socket id
const rooms = new Map();
const validRoom = (r) => typeof r === 'string' && /^[\w-]{1,20}$/.test(r);

io.on('connection', (socket) => {
  console.log('A user connected!');

  // A host claims a room. Only the host of a room may broadcast state to it.
  socket.on('hostRoom', (room, ack) => {
    if (typeof ack !== 'function') return;
    if (!validRoom(room)) return ack({ ok: false, error: 'Invalid room code.' });
    const current = rooms.get(room);
    if (current && current !== socket.id) return ack({ ok: false, error: 'Room already has a host.' });
    rooms.set(room, socket.id);
    socket.data.hostRoom = room;
    socket.join(room);
    ack({ ok: true });
  });

  socket.on('joinRoom', (room, ack) => {
    if (typeof ack !== 'function') return;
    if (!validRoom(room)) return ack({ ok: false, error: 'Invalid room code.' });
    if (!rooms.has(room)) return ack({ ok: false, error: 'No host in that room yet.' });
    socket.join(room);
    ack({ ok: true });
  });

  // Host sends physics data (flat array), relayed to the viewers in the same room.
  socket.on('stateUpdate', (data) => {
    const room = socket.data.hostRoom;
    if (!room || !Array.isArray(data) || data.length !== 12) return;
    socket.volatile.to(room).emit('stateUpdate', data);
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    const room = socket.data.hostRoom;
    if (room && rooms.get(room) === socket.id) {
      rooms.delete(room);
      io.to(room).emit('hostLeft');
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
