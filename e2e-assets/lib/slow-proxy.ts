/**
 * A TCP proxy that really slows uploads (client → server) to `bytesPerSecond`, passes downloads at full speed, and
 * closes the upstream connection when the browser closes its side. Chrome's DevTools throttling only delays what the
 * page sees: the network stack still sends the body at full speed, so it cannot test "cancel in the middle".
 */
import net from 'node:net';

export function startSlowProxy(listenPort: number, target: { host: string; port: number }, bytesPerSecond: number) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(target.port, target.host);
    sockets.add(client).add(upstream);
    let queue: Buffer[] = [];
    let closed = false;
    const tick = setInterval(() => {
      let budget = Math.ceil(bytesPerSecond / 20);
      while (budget > 0 && queue.length) {
        const head = queue[0];
        if (head.length <= budget) {
          upstream.write(head);
          budget -= head.length;
          queue.shift();
        } else {
          upstream.write(head.subarray(0, budget));
          queue[0] = head.subarray(budget);
          budget = 0;
        }
      }
      if (closed && !queue.length) upstream.end();
    }, 50);
    client.on('data', (d) => queue.push(d));
    upstream.on('data', (d) => client.write(d));
    const shut = () => {
      clearInterval(tick);
      queue = [];
      client.destroy();
      upstream.destroy();
    };
    client.on('close', shut); // browser cancelled / closed: the server sees the connection drop
    client.on('end', () => (closed = true));
    upstream.on('close', shut);
    client.on('error', shut);
    upstream.on('error', shut);
  });
  return new Promise<{ close: () => Promise<void> }>((resolve) =>
    server.listen(listenPort, '127.0.0.1', () =>
      resolve({
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      }),
    ),
  );
}
