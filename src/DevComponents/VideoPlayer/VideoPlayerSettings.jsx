import React from "react";
import "./VideoPlayerSettings.css"; // Ensure you have a corresponding CSS file

const VideoPlayerSettings = ({
  resolution,
  setResolution,
  playbackSpeed,
  setPlaybackSpeed,
  captionsEnabled,
  handleCaptionsToggle,
}) => {
  // Define resolution and playback speed options
  const resolutionOptions = ["1080p", "720p", "480p", "240p"];
  const playbackSpeedOptions = ["1", "1.25", "1.5", "2"];

  return (
    <div className="settings-popup">
      {/* Quality Settings */}
      <div>
        <div className="settings-menu-label">
          <label>Quality</label>
        </div>
        <div className="settings-menu-btn-label">
          {resolutionOptions.map((res) => (
            <button
              key={res}
              onClick={() => setResolution(res)}
              className={resolution === res ? "selected" : ""}
            >
              {res}
            </button>
          ))}
        </div>
      </div>

      {/* Playback Speed Settings */}
      <div>
        <div className="settings-menu-label">
          <label>Playback Speed</label>
        </div>
        <div className="settings-menu-btn-label">
          {playbackSpeedOptions.map((speed) => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={playbackSpeed === speed ? "selected" : ""}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      {/* Captions Toggle */}
      <div className="toggle-container">
        <div
          className={`toggle-switch ${true ? "enabled" : "disabled"}`}
          onClick={handleCaptionsToggle}
        >
          <div>
            <div className="settings-menu-label captions-label">
              <label>Captions</label>
            </div>
          </div>
          <div className="toggle-slider"></div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayerSettings;
