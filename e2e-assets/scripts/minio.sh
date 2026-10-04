#!/usr/bin/env bash
# Stops / starts the local MinIO used by the asset scenarios (E: storage outage).
# Credentials stay in the root-only /opt/minio/etc/env; nothing secret is in this file.
set -u
case "${1:-}" in
  stop)
    pkill -f "minio server /opt/minio/data" ; for i in $(seq 1 50); do pgrep -f "minio server /opt/minio/data" >/dev/null || { echo stopped; exit 0; }; sleep 0.2; done; echo "still running"; exit 1 ;;
  start)
    pgrep -f "minio server /opt/minio/data" >/dev/null && { echo "already running"; exit 0; }
    set -a; . /opt/minio/etc/env; set +a
    setsid nohup /opt/minio/gopath/bin/minio server /opt/minio/data --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 >>/opt/minio/minio.log 2>&1 </dev/null &
    for i in $(seq 1 100); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/minio/health/ready | grep -q 200 && { echo started; exit 0; }; sleep 0.2; done
    echo "did not start"; exit 1 ;;
  *) echo "usage: $0 start|stop"; exit 2 ;;
esac
