/** One pending WS challenge; never persists capabilities or retries redemption. */
export class AutoChallenge {
  private pending:
    | {
        resolve(value: string): void;
        reject(reason: Error): void;
      }
    | undefined;
  private timer?: ReturnType<typeof setTimeout>;
  wait(): Promise<string> {
    this.cancel();
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.timer = setTimeout(() => {
        this.cancel();
      }, 8000);
    });
  }
  accept(value: unknown): void {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
      this.cancel();
      return;
    }
    this.pending?.resolve(value);
    this.pending = undefined;
    clearTimeout(this.timer);
  }
  cancel(): void {
    this.pending?.reject(new Error('Automatic connection unavailable'));
    this.pending = undefined;
    clearTimeout(this.timer);
  }
}
