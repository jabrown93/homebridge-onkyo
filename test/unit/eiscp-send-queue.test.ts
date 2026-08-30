import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Eiscp } from '../../src/eiscp/eiscp.js';

/**
 * Exercises the serial send chain that replaced async.queue. Reaching in past
 * the private fields is deliberate: the queue's whole contract is ordering,
 * spacing and error propagation, none of which is observable from the public
 * surface without a real receiver on the other end of a socket.
 */
type EiscpInternals = {
  is_connected: boolean;
  eiscp: { write: (packet: Buffer) => void };
  config: { send_delay: number; host: string };
};

const internals = (device: Eiscp) => device as unknown as EiscpInternals;

describe('Eiscp send queue', () => {
  let device: Eiscp;
  let written: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    written = [];
    device = new Eiscp(console);
    device.on('debug', () => undefined);
    device.on('error', () => undefined);

    const inner = internals(device);
    inner.is_connected = true;
    inner.config.send_delay = 100;
    inner.eiscp = {
      write: (packet: Buffer) => {
        written.push(packet.toString('binary'));
      },
    };
  });

  it('sends queued commands in order, spaced by send_delay', async () => {
    device.raw('PWR01');
    device.raw('PWR02');
    device.raw('PWR03');

    await vi.advanceTimersByTimeAsync(0);
    expect(written).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(written).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(written).toHaveLength(3);

    // Each eISCP packet is a 16-byte header wrapping "!1<command>\r\n".
    const commands = written.map(packet => packet.slice(18, -2));
    expect(commands).toEqual(['PWR01', 'PWR02', 'PWR03']);
  });

  it('passes undefined to the callback on success', async () => {
    const callback = vi.fn();
    device.raw('PWR01', callback);

    await vi.advanceTimersByTimeAsync(100);

    expect(callback).toHaveBeenCalledWith(undefined, null);
  });

  it('settles the callback with an error when disconnected', async () => {
    internals(device).is_connected = false;
    const callback = vi.fn();

    device.raw('PWR01', callback);
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledTimes(1);
    const [error] = callback.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('send_not_connected');
    expect(written).toHaveLength(0);
  });

  it('keeps draining the queue after a failed send', async () => {
    const inner = internals(device);
    inner.is_connected = false;
    const first = vi.fn();
    const second = vi.fn();

    device.raw('PWR01', first);
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledTimes(1);

    inner.is_connected = true;
    device.raw('PWR02', second);
    await vi.advanceTimersByTimeAsync(100);

    expect(second).toHaveBeenCalledWith(undefined, null);
    expect(written).toHaveLength(1);
  });

  it('rejects an empty command without touching the queue', () => {
    const callback = vi.fn();
    device.raw('', callback);

    expect(callback).toHaveBeenCalledWith(true, 'No data provided.');
    expect(written).toHaveLength(0);
  });
});
