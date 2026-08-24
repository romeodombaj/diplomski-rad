// Simple active-liveness check: confirm the eyes go open -> closed -> open
// (a real blink) before letting a scan proceed to face verification.
// Deliberately plain JS state, not worklet code — the frame processor only
// extracts eye-open probabilities per frame and hands them to this via
// runOnJS; all the stateful tracking happens on the normal JS thread.

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

  /**
   * Feed one frame's eye-open probabilities (0..1, from ML Kit-style face
   * detection). Returns true the moment a full blink has been confirmed.
   */
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
