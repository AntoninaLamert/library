/* Тихая фоновая запись: переходы между комнатами не прерывают музыку. */
(function (root) {
  'use strict';

  class Music {
    constructor(audio) {
      this.audio = audio || null;
      this.currentLocation = null;
      this.isMuted = false;
      this.isPaused = false;
      this.playVersion = 0;
      if (this.audio) {
        this.audio.loop = true;
        this.audio.preload = 'none';
        this.audio.volume = .16;
      }
    }

    get supported() { return typeof this.audio?.play === 'function'; }
    get shouldPlay() { return !!this.currentLocation && !this.isMuted && !this.isPaused; }
    get isPlaying() { return this.shouldPlay && !!this.audio && !this.audio.paused && !this.audio.ended; }

    async syncPlayback() {
      if (!this.supported) return;
      if (!this.shouldPlay) {
        this.playVersion++;
        this.audio.pause();
        return;
      }
      if (!this.audio.paused) return;
      const version = ++this.playVersion;
      try { await this.audio.play(); }
      catch (error) {
        // pause() отменяет ещё не завершившийся play(): это ожидаемая пауза.
        if (version === this.playVersion && this.shouldPlay) throw error;
        return;
      }
      // Загрузка записи могла завершиться уже после ухода из игры.
      if (!this.shouldPlay) this.audio.pause();
    }

    async setLocation(name) {
      this.currentLocation = name;
      await this.syncPlayback();
    }

    async toggle() {
      this.isMuted = !this.isMuted;
      await this.syncPlayback();
      return !this.isMuted;
    }

    async setPaused(paused) {
      if (this.isPaused === paused) return;
      this.isPaused = paused;
      await this.syncPlayback();
    }

    async stop() {
      this.currentLocation = null;
      await this.syncPlayback();
      if (this.audio) {
        try { this.audio.currentTime = 0; }
        catch { /* Метаданные ещё могли не загрузиться. */ }
      }
    }
  }

  const api = { Music };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuestMusic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
