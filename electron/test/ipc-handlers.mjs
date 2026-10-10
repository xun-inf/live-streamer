import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import * as flatbuffers from 'flatbuffers';

import { IpcClient } from '../dist/main/mediaservice/IpcClient.js';
import { readEnvelope } from '../dist/main/mediaservice/IpcBuffer.js';
import { StreamPreviewHandler } from '../dist/main/ipchandlers/StreamPreviewHandler.js';
import { Domain } from '../dist/common/ipcs/domain.js';
import { Envelope } from '../dist/common/ipcs/envelope.js';
import { StreamPreviewPayload } from '../dist/common/ipcs/stream-preview-payload.js';
import { PresentVideoFrame } from '../dist/common/ipcs/present-video-frame.js';
import { ReleaseVideoFrame } from '../dist/common/ipcs/release-video-frame.js';
import { logger } from '../dist/main/logger.js';

function envelope(domain, type = StreamPreviewPayload.NONE, frame = null) {
  const builder = new flatbuffers.Builder(128);
  const body = frame ? PresentVideoFrame.createPresentVideoFrame(builder,
    frame.id, frame.token, frame.handle, frame.width, frame.height, frame.timestamp) : 0;
  Envelope.startEnvelope(builder);
  Envelope.addDomain(builder, domain);
  Envelope.addStreamPreviewType(builder, type);
  if (body) Envelope.addStreamPreview(builder, body);
  builder.finish(Envelope.endEnvelope(builder));
  return Buffer.from(builder.asUint8Array());
}

function wire(payload) {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(payload.length);
  return Buffer.concat([prefix, payload]);
}

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('IPC handler test timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

let sequence = 0;
async function fixture(t) {
  const server = net.createServer();
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  const pipe = '\\\\.\\pipe\\ipc-handlers-' + process.pid + '-' + ++sequence;
  server.listen(pipe);
  await once(server, 'listening');
  const client = new IpcClient();
  t.after(async () => {
    client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  const connect = async () => {
    const connected = once(server, 'connection');
    await client.connect(pipe);
    return (await connected)[0];
  };
  return { client, connect };
}

test('registration, routing, fragmented/coalesced frames and reconnect', async t => {
  const { client, connect } = await fixture(t);
  const received = [];
  for (const domain of [Domain.NativeWindow, Domain.StreamPreview]) {
    assert.equal(client.registerHandler({ domain: () => domain, onIpcMessage: message => {
      received.push(message.domain());
      return true;
    } }), true);
  }
  assert.equal(client.registerHandler({ domain: () => Domain.None }), false);
  assert.equal(client.registerHandler({ domain: () => 99 }), false);
  assert.equal(client.registerHandler({ domain: () => Domain.StreamPreview }), false);
  let socket = await connect();
  const first = wire(envelope(Domain.StreamPreview));
  socket.write(first.subarray(0, 3));
  socket.write(Buffer.concat([first.subarray(3), wire(envelope(Domain.NativeWindow))]));
  await waitFor(() => received.length === 2);
  assert.deepEqual(received, [Domain.StreamPreview, Domain.NativeWindow]);
  client.close();
  socket = await connect();
  socket.write(wire(envelope(Domain.StreamPreview)));
  await waitFor(() => received.length === 3);
  assert.deepEqual(received, [Domain.StreamPreview, Domain.NativeWindow, Domain.StreamPreview]);
});

test('bad messages and handler failures are isolated; invalid framing closes connection', async t => {
  const warnings = [];
  const warning = logger.warning;
  logger.warning = (...args) => warnings.push(args);
  t.after(() => { logger.warning = warning; });
  const { client, connect } = await fixture(t);
  let calls = 0;
  client.registerHandler({ domain: () => Domain.StreamPreview, onIpcMessage: () => {
    ++calls;
    if (calls === 1) return false;
    if (calls === 2) throw new Error('Intentional handler failure');
    return true;
  } });
  const socket = await connect();
  const malformed = envelope(Domain.StreamPreview);
  malformed.writeUInt32LE(0xfffffff0, 0);
  socket.write(Buffer.concat([
    wire(Buffer.from([1])), wire(malformed), wire(envelope(99)), wire(envelope(Domain.NativeWindow)),
    ...Array.from({ length: 3 }, () => wire(envelope(Domain.StreamPreview))),
  ]));
  await waitFor(() => calls === 3);
  assert.equal(client.connected, true);
  assert.equal(warnings.length, 6);
  let closes = 0;
  client.setCloseHandler(() => { ++closes; });
  socket.write(Buffer.alloc(4));
  await waitFor(() => closes === 1);
  assert.equal(client.connected, false);
});

test('StreamPreview handler validates input and builds the release reply', () => {
  const sent = [];
  const frames = [];
  const handler = new StreamPreviewHandler({ send: message => { sent.push(Buffer.from(message)); return true; } }, {
    presentFrame: (frame, release) => frames.push({ frame, release }),
  });
  const frame = { id: 7, token: 11n, handle: 33n, width: 1920, height: 1080, timestamp: 100000n };
  const dispatch = (data, domain = Domain.StreamPreview, type = StreamPreviewPayload.PresentVideoFrame) =>
    handler.onIpcMessage(readEnvelope(envelope(domain, type, data)));
  assert.equal(dispatch(frame, Domain.NativeWindow), false);
  assert.equal(dispatch(frame, Domain.StreamPreview, StreamPreviewPayload.ReleaseVideoFrame), false);
  assert.equal(dispatch(null), false);
  for (const patch of [{ token: 0n }, { handle: 0n }, { width: 0 }, { height: 8193 },
    { timestamp: 9007199254740992n }]) {
    assert.equal(dispatch({ ...frame, ...patch }), false);
  }
  assert.deepEqual(frames, []);
  assert.equal(dispatch(frame), true);
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].frame, { ...frame, timestamp: 100000 });
  assert.equal(sent.length, 0);
  frames[0].release();
  const reply = readEnvelope(sent[0]);
  assert.equal(reply.domain(), Domain.StreamPreview);
  assert.equal(reply.streamPreviewType(), StreamPreviewPayload.ReleaseVideoFrame);
  const body = reply.streamPreview(new ReleaseVideoFrame());
  assert.equal(body.id(), frame.id);
  assert.equal(body.token(), frame.token);
});
