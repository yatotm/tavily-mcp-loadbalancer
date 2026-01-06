export class ConnectionStore {
  private sseConnections = 0;
  private wsConnections = 0;

  setSse(count: number): void {
    this.sseConnections = count;
  }

  setWs(count: number): void {
    this.wsConnections = count;
  }

  getSnapshot(): { sse: number; ws: number } {
    return { sse: this.sseConnections, ws: this.wsConnections };
  }
}
