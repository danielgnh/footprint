export class Stopwatch {
    private since: number | null = null;
    private total = 0;

    run(now: number): void {
        if (this.since === null) {
            this.since = now;
        }
    }

    pause(now: number): void {
        if (this.since !== null) {
            this.total += now - this.since;
            this.since = null;
        }
    }

    take(now: number): number {
        let elapsed = this.total;

        if (this.since !== null) {
            elapsed += now - this.since;
            this.since = now;
        }

        this.total = 0;

        return elapsed;
    }
}
