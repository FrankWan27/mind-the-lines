import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../shared/src/types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

/** Fully-typed socket. Server->Client events and Client->Server acks are checked. */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: true,
});
