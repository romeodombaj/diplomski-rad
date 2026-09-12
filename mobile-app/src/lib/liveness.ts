
const EYE_OPEN_THRESHOLD = 0.6;
const EYE_CLOSED_THRESHOLD = 0.3;

export type LivenessStage = 'waiting-face' | 'waiting-blink' | 'confirmed';

export class BlinkLivenessDetector {
  private sawOpen = false;
  private sawClosed = false;
  confirmed = false;

  reset(): void {
    this.sawOpen = false;
    this.sawClosed = false;
    this.confirmed = false;
  }

  get stage(): LivenessStage {
    if (this.confirmed) return 'confirmed';
    if (this.sawOpen) return 'waiting-blink';
    return 'waiting-face';
  }

  update(leftEyeOpen: number, rightEyeOpen: number): boolean {
    if (this.confirmed) return true;
    const avgOpen = (leftEyeOpen + rightEyeOpen) / 2;

    if (!this.sawOpen) {
      if (avgOpen >= EYE_OPEN_THRESHOLD) this.sawOpen = true;
      return false;
    }
    if (!this.sawClosed) {
      if (avgOpen <= EYE_CLOSED_THRESHOLD) this.sawClosed = true;
      return false;
    }
    if (avgOpen >= EYE_OPEN_THRESHOLD) {
      this.confirmed = true;
      return true;
    }
    return false;
  }
}
