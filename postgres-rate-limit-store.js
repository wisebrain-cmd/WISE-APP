class PostgresRateLimitStore {
  constructor(pool, prefix) {
    this.pool = pool;
    this.prefix = prefix;
    this.windowMs = 60000;
    this.lastCleanupAt = 0;
  }

  init(options) {
    this.windowMs = Number(options.windowMs) || this.windowMs;
  }

  async increment(key) {
    const now = Date.now();
    if (now - this.lastCleanupAt > 5 * 60 * 1000) {
      this.lastCleanupAt = now;
      await this.pool.query("DELETE FROM rate_limit_buckets WHERE reset_at < NOW()").catch(error => {
        console.error("Rate limit bucket cleanup failed:", error.message);
      });
    }
    const result = await this.pool.query(`INSERT INTO rate_limit_buckets (bucket_key, hit_count, reset_at)
      VALUES ($1, 1, NOW() + ($2 * INTERVAL '1 millisecond'))
      ON CONFLICT (bucket_key) DO UPDATE SET
        hit_count = CASE WHEN rate_limit_buckets.reset_at <= NOW() THEN 1 ELSE rate_limit_buckets.hit_count + 1 END,
        reset_at = CASE WHEN rate_limit_buckets.reset_at <= NOW()
          THEN NOW() + ($2 * INTERVAL '1 millisecond') ELSE rate_limit_buckets.reset_at END
      RETURNING hit_count, reset_at`, [`${this.prefix}:${key}`, this.windowMs]);
    return { totalHits: Number(result.rows[0].hit_count), resetTime: result.rows[0].reset_at };
  }

  async decrement(key) {
    await this.pool.query("UPDATE rate_limit_buckets SET hit_count = GREATEST(hit_count - 1, 0) WHERE bucket_key = $1", [`${this.prefix}:${key}`]);
  }

  async resetKey(key) {
    await this.pool.query("DELETE FROM rate_limit_buckets WHERE bucket_key = $1", [`${this.prefix}:${key}`]);
  }

  async resetAll() {
    await this.pool.query("DELETE FROM rate_limit_buckets WHERE bucket_key LIKE $1", [`${this.prefix}:%`]);
  }
}

module.exports = { PostgresRateLimitStore };
