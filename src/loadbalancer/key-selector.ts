import { ApiKeyRecord } from '../data/database.js';

export class KeySelector {
  private currentIndex = -1;
  private currentWeight = 0;
  private maxWeight = 0;
  private gcdWeight = 1;

  reset(keys: ApiKeyRecord[]): void {
    this.currentIndex = -1;
    this.currentWeight = 0;
    this.maxWeight = Math.max(0, ...keys.map((key) => key.weight || 0));
    this.gcdWeight = this.calculateGcd(keys.map((key) => key.weight || 0));
  }

  select(keys: ApiKeyRecord[]): ApiKeyRecord | null {
    if (keys.length === 0) return null;
    if (this.maxWeight === 0) {
      this.reset(keys);
    }
    while (true) {
      this.currentIndex = (this.currentIndex + 1) % keys.length;
      if (this.currentIndex === 0) {
        this.currentWeight = this.currentWeight - this.gcdWeight;
        if (this.currentWeight <= 0) {
          this.currentWeight = this.maxWeight;
          if (this.currentWeight === 0) {
            return null;
          }
        }
      }
      const candidate = keys[this.currentIndex];
      if ((candidate.weight || 0) >= this.currentWeight) {
        return candidate;
      }
    }
  }

  private calculateGcd(numbers: number[]): number {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    return numbers.reduce((acc, value) => gcd(acc, value || 0), numbers[0] || 1);
  }
}
