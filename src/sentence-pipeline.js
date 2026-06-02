/**
 * Prefetch pipeline: synthesize sentence N+1 while playing sentence N.
 */
export class SentencePipeline {
  constructor({ synthesize, onStatus, lookahead = 1 }) {
    this.synthesize = synthesize;
    this.onStatus = onStatus || (() => {});
    this.lookahead = lookahead;
    this.cache = new Map();
    this.inFlight = new Map();
    this.aborted = false;
    this.generation = 0;
    this._prefetchDelay = 200; // ms between prefetch requests
  }

  reset() {
    this.generation += 1;
    this.aborted = true;
    this.cache.clear();
    this.inFlight.clear();
    this.aborted = false;
    this.emitStatus();
  }

  emitStatus() {
    const ready = this.cache.size;
    const loading = this.inFlight.size;
    this.onStatus({ ready, loading });
  }

  async ensure(index, sentence, voice, gen) {
    if (gen !== this.generation) throw new Error("cancelled");
    if (this.cache.has(index)) return this.cache.get(index);

    if (this.inFlight.has(index)) {
      return this.inFlight.get(index);
    }

    const promise = (async () => {
      try {
        const item = await this.synthesize(sentence, voice);
        if (gen === this.generation && !this.aborted) {
          this.cache.set(index, item);
        }
        return item;
      } finally {
        this.inFlight.delete(index);
        if (gen === this.generation) this.emitStatus();
      }
    })();

    this.inFlight.set(index, promise);
    this.emitStatus();
    return promise;
  }

  async prefetchRange(sentences, startIndex, voice, gen) {
    const end = Math.min(sentences.length, startIndex + this.lookahead);
    for (let i = startIndex; i < end; i++) {
      if (!this.cache.has(i) && !this.inFlight.has(i)) {
        // Throttle: wait before starting next prefetch to avoid API rate limits
        if (i > startIndex) {
          await new Promise((r) => setTimeout(r, this._prefetchDelay));
        }
        this.ensure(i, sentences[i], voice, gen).catch(() => {});
      }
    }
  }

  async getReady(index, sentences, voice, gen) {
    this.prefetchRange(sentences, index, voice, gen);
    return this.ensure(index, sentences[index], voice, gen);
  }

  revokeAll() {
    for (const item of this.cache.values()) {
      if (item instanceof Blob) {
        /* blob urls revoked by player */
      }
    }
    this.cache.clear();
  }
}
