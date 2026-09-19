export class BrowserTaskQueue {
  #interactive = [];
  #normal = [];
  #running = false;

  enqueue(task, { priority = "normal" } = {}) {
    if (typeof task !== "function") throw new TypeError("Browser task must be a function.");
    const queue = priority === "interactive" ? this.#interactive : this.#normal;
    const promise = new Promise((resolve, reject) => queue.push({ task, resolve, reject }));
    void this.#drain();
    return promise;
  }

  async #drain() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#interactive.length || this.#normal.length) {
        const entry = this.#interactive.shift() || this.#normal.shift();
        try {
          entry.resolve(await entry.task());
        } catch (error) {
          entry.reject(error);
        }
      }
    } finally {
      this.#running = false;
    }
  }
}
