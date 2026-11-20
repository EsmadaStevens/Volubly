/**
 * One on-device model, many things that want it. This makes them take turns and lets the
 * important ones go first: sending your own message beats a catch-up you asked for, which
 * beats quietly checking someone else's message.
 *
 * It cannot interrupt a check that is already running, so a send check may wait for the one
 * in front of it to finish (usually about a second). Reader checks never pile up: they wait
 * a short time and are then skipped, and a full queue drops its oldest reader check.
 */
export type Priority = 'send' | 'catch_up' | 'read'
export type Scheduled<T> = { ran: true; value: T } | { ran: false }
export type Schedule = <T>(priority: Priority, run: () => Promise<T>, maxWaitMs?: number) => Promise<Scheduled<T>>

const RANK: Record<Priority, number> = { send: 0, catch_up: 1, read: 2 }

interface Job {
  priority: Priority
  seq: number
  start: () => void
  cancel: () => void
  timer?: ReturnType<typeof setTimeout>
}

export class InferenceQueue {
  private running = false
  private pending: Job[] = []
  private seq = 0

  constructor(private maxPendingReads = 8) {}

  get depth(): number {
    return this.pending.length
  }

  submit<T>(priority: Priority, run: () => Promise<T>, maxWaitMs?: number): Promise<Scheduled<T>> {
    return new Promise((resolve) => {
      const job: Job = {
        priority,
        seq: this.seq++,
        start: () => {
          this.running = true
          run()
            .then(
              (value) => resolve({ ran: true, value }),
              () => resolve({ ran: false }),
            )
            .finally(() => {
              this.running = false
              this.next()
            })
        },
        cancel: () => resolve({ ran: false }),
      }
      if (!this.running) return job.start()

      if (priority === 'read') {
        const reads = this.pending.filter((p) => p.priority === 'read')
        if (reads.length >= this.maxPendingReads) this.drop(reads[0])
      }
      if (maxWaitMs !== undefined) job.timer = setTimeout(() => this.drop(job), maxWaitMs)
      this.pending.push(job)
      this.pending.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq)
    })
  }

  private drop(job: Job) {
    clearTimeout(job.timer)
    this.pending = this.pending.filter((p) => p !== job)
    job.cancel()
  }

  private next() {
    const job = this.pending.shift()
    if (!job) return
    clearTimeout(job.timer)
    job.start()
  }
}
