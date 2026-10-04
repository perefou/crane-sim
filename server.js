const express = require('express');
const path = require('path');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { transports: ['websocket'] });

// Only the public/ folder is served (index.html, rig.obj, rig.mtl), not server.js or package.json.
app.use(express.static(path.join(__dirname, 'public')));

// room name -> { host: socket id, viewers: Map(socket id -> input bitmask) }
// Input bitmask: 1 cwFwd, 2 cwBack, 4 rotCCW, 8 rotCW, 16 tagCCW, 32 tagCW
const rooms = new Map();
const validRoom = (r) => typeof r === 'string' && /^[\w-]{1,20}$/.test(r);

const combinedInput = (room) => {
  let mask = 0;
  for (const m of room.viewers.values()) mask |= m;
  return mask;
};

// Where each viewer stands: [socket id, mode (0 floor, 1 platform), x, y, z, yaw]
const viewList = (room) => Array.from(room.views, ([id, v]) => [id, ...v]);
const sendViews = (name, room) => io.to(name).emit('views', viewList(room));

io.on('connection', (socket) => {
  console.log('A user connected!');

  // A host claims a room. Only the host of a room may broadcast state to it.
  socket.on('hostRoom', (name, ack) => {
    if (typeof ack !== 'function') return;
    if (!validRoom(name)) return ack({ ok: false, error: 'Invalid room code.' });
    const room = rooms.get(name);
    if (room && room.host !== socket.id) return ack({ ok: false, error: 'Room already has a host.' });
    if (!room) rooms.set(name, { host: socket.id, viewers: new Map(), views: new Map() });
    socket.data.hostRoom = name;
    socket.join(name);
    ack({ ok: true });
    socket.emit('views', viewList(rooms.get(name)));
  });

  socket.on('joinRoom', (name, ack) => {
    if (typeof ack !== 'function') return;
    if (!validRoom(name)) return ack({ ok: false, error: 'Invalid room code.' });
    if (!rooms.has(name)) return ack({ ok: false, error: 'No host in that room yet.' });
    socket.data.viewerRoom = name;
    socket.join(name);
    ack({ ok: true });
    socket.emit('views', viewList(rooms.get(name)));
  });

  // A viewer reports where it stands and which way it faces, so everyone can see its person.
  socket.on('view', (v) => {
    const name = socket.data.viewerRoom;
    const room = rooms.get(name);
    if (!room || !Array.isArray(v) || v.length !== 5 || !v.every(Number.isFinite)) return;
    const [mode, x, y, z, yaw] = v;
    if (mode !== 0 && mode !== 1) return;
    if (Math.abs(x) > 500 || Math.abs(z) > 500 || y < -1 || y > 300 || Math.abs(yaw) > 1000) return;
    room.views.set(socket.id, v);
    sendViews(name, room);
  });

  // Host sends physics data (flat array), relayed to the viewers in the same room.
  socket.on('stateUpdate', (data) => {
    const name = socket.data.hostRoom;
    if (!name || !Array.isArray(data) || data.length !== 15) return;
    socket.volatile.to(name).emit('stateUpdate', data);
  });

  // A viewer sends which counterweight/rotation buttons it holds; the host gets the combined mask.
  socket.on('input', (mask) => {
    const room = rooms.get(socket.data.viewerRoom);
    if (!room || !Number.isInteger(mask) || mask < 0 || mask > 63) return;
    room.viewers.set(socket.id, mask);
    io.to(room.host).emit('input', combinedInput(room));
  });

  // A viewer asks the host to strap/unstrap the load, or to lock/unlock its heading.
  socket.on('hook', () => {
    const room = rooms.get(socket.data.viewerRoom);
    if (room) io.to(room.host).emit('hook');
  });
  socket.on('lock', () => {
    const room = rooms.get(socket.data.viewerRoom);
    if (room) io.to(room.host).emit('lock');
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');

    const hostName = socket.data.hostRoom;
    const hostedRoom = rooms.get(hostName);
    if (hostedRoom && hostedRoom.host === socket.id) {
      rooms.delete(hostName);
      io.to(hostName).emit('hostLeft');
    }

    // Release this viewer's buttons so nothing stays stuck on the host.
    const viewedRoom = rooms.get(socket.data.viewerRoom);
    if (viewedRoom) {
      if (viewedRoom.viewers.delete(socket.id)) {
        io.to(viewedRoom.host).emit('input', combinedInput(viewedRoom));
      }
      if (viewedRoom.views.delete(socket.id)) sendViews(socket.data.viewerRoom, viewedRoom);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
