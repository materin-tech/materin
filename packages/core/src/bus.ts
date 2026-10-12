/**
 * Minimal event bus — extension 总线与 SSE 共用同一套事件流 (一套总线两个消费者).
 */

export type Listener<T> = (event: T) => void

export class Bus<T> {
  private listeners = new Set<Listener<T>>()

  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  emit(event: T): void {
    for (const fn of this.listeners) {
      try {
        fn(event)
      } catch (e) {
        // 一个消费者失败不拖垮其他消费者
        console.error('[bus] listener error:', e)
      }
    }
  }
}
