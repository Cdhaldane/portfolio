import React, { useState, useRef, useEffect, useCallback } from "react";
import Spinner from "../Spinner/Spinner";
import { useEventListener } from "../../Utils";
import AvailableLanguages from "./AvailableLanguages/AvailableLanguages";
import ToolTip from "../ToolTip/ToolTip";
import VideoPlayerSettings from "./VideoPlayerSettings";

import "./VideoPlayer.css"; // Make sure to create a corresponding CSS file for styling

const VideoPlayer = ({ videoSource }) => {
  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showTimeline, setShowTimeline] = useState(false);
  const [volume, setVolume] = useState(1); // Default volume
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState("1");
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [resolution, setResolution] = useState("1080p");
  const [isFullScreen, setFullscreen] = useState(false);
  const [isCursorVisible, setIsCursorVisible] = useState(true);
  const [spinner, setSpinner] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);

  const mouseMoveTimer = useRef(null);
  const volumeContainerRef = useRef(null);
  const settingsRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration || 0);
    }
  }, [videoRef]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (document.activeElement.tagName.toLowerCase() === "input") {
        return;
      }
      const video = videoRef.current;
      if (!video) return;

      switch (event.key) {
        case " ":
          event.preventDefault();
          togglePlayPause();
          break;
        case "f":
          handleFullscreen();
          break;
        case "m":
          handleVolumeChange({ target: { value: volume === 0 ? 1 : 0 } });
          break;
        default:
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [volume]);

  const toggleVolume = () => {
    setShowVolumeSlider(!showVolumeSlider);
  };

  const handleVolumeChange = (e) => {
    const newVolume = e.target.value;
    setVolume(newVolume);
    videoRef.current.volume = newVolume;
  };

  const toggleSettings = () => {
    setShowSettings(!showSettings);
  };

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (video.paused) {
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const handleVideoEnded = () => {
    if (!videoEnded) {
      setPlaying(false);
      setVideoEnded(true);
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video) {
      setCurrentTime(video.currentTime);
    }
  };

  const handleMouseMove = () => {
    if (isFullScreen) {
      clearTimeout(mouseMoveTimer.current);
      setIsCursorVisible(true);
      setShowTimeline(true);
      mouseMoveTimer.current = setTimeout(() => {
        setIsCursorVisible(false);
        setShowTimeline(false);
      }, 1000);
    } else {
      setIsCursorVisible(true);
      setShowTimeline(true);
    }
  };

  const handleTimelineClick = (e) => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const rect = timeline.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * duration;

    videoRef.current.currentTime = newTime;
  };

  const fullscreenChange = () => {
    const isFS = !!document.fullscreenElement;
    setFullscreen(isFS);
  };

  const handleDocumentClick = (e) => {
    if (showVolumeSlider && !volumeContainerRef.current.contains(e.target)) {
      setShowVolumeSlider(false);
    }
    if (showSettings && !settingsRef.current.contains(e.target)) {
      setShowSettings(false);
    }
  };

  useEventListener("mousemove", handleMouseMove, videoRef.current);
  useEventListener("fullscreenchange", fullscreenChange);
  useEventListener("click", handleDocumentClick);

  const formatTime = (time) => {
    if (!isNaN(time)) {
      const hours = Math.floor(time / 3600);
      const minutes = Math.floor((time % 3600) / 60);
      const seconds = Math.floor(time % 60);

      if (hours > 0) {
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
          2,
          "0"
        )}:${String(seconds).padStart(2, "0")}`;
      } else {
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
          2,
          "0"
        )}`;
      }
    }
    return "00:00";
  };

  const handleCaptionsToggle = () => {
    setCaptionsEnabled(!captionsEnabled);
  };

  const handleFullscreen = () => {
    const video = document.getElementsByClassName("video-player")[0];
    if (video) {
      if (!isFullScreen) {
        if (video.requestFullscreen) {
          video.requestFullscreen({ navigationUI: "hide" });
        } else if (video.webkitRequestFullscreen) {
          video.webkitRequestFullscreen();
        } else if (video.msRequestFullscreen) {
          video.msRequestFullscreen();
        }
      } else {
        document.exitFullscreen();
      }
    }
  };

  return (
    <div
      onMouseEnter={() => setShowTimeline(true)}
      onMouseLeave={() => {
        setTimeout(() => {
          if (showSettings) return;
          setShowTimeline(false);
        }, 1000);
      }}
      className={`video-player ${isFullScreen ? "" : ""}`}
      style={{ cursor: isCursorVisible ? "default" : "none" }}
    >
      <video
        ref={videoRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration || 0);
          }
        }}
        onClick={togglePlayPause}
        onEnded={handleVideoEnded}
      >
        <source src={videoSource} type="video/mp4" />
        Your browser does not support the video tag.
      </video>

      <div className={`controls ${showTimeline ? "show" : ""}`}>
        <div
          className={`timeline`}
          ref={timelineRef}
          onClick={handleTimelineClick}
        >
          <div
            className="progress"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          ></div>
        </div>

        <div className="video-player-control">
          <div className="play-time-volume">
            <div className="play-pause-btn-control" onClick={togglePlayPause}>
              {playing ? (
                <ToolTip content={"Pause"}>
                  <i className="fa-solid fa-pause" id="controls-btn-pause"></i>
                </ToolTip>
              ) : (
                <ToolTip content={"Play"}>
                  <i className="fa-solid fa-play" id="controls-btn-play"></i>
                </ToolTip>
              )}
            </div>

            <div className="time-display">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>

            <div className="volume-container" ref={volumeContainerRef}>
              {volume === 0 ? (
                <ToolTip content={"Mute"}>
                  <i
                    className="fa-solid fa-volume-xmark"
                    id="controls-btn-volume"
                    onClick={toggleVolume}
                  ></i>
                </ToolTip>
              ) : (
                <ToolTip content={"Volume"}>
                  <i
                    className="fa-solid fa-volume-high"
                    id="controls-btn-volume"
                    onClick={toggleVolume}
                  ></i>
                </ToolTip>
              )}

              {showVolumeSlider && (
                <div className="volume-slider-container">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="volume-slider"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="langauge-setting-fullscreen">
            <div className="settings-popup-container" ref={settingsRef}>
              <ToolTip content={"Setting"}>
                <i
                  className="fa-solid fa-cog"
                  id="controls-btn-setting"
                  onClick={toggleSettings}
                ></i>
              </ToolTip>

              {showSettings && (
                <VideoPlayerSettings
                  resolution={resolution}
                  setResolution={setResolution}
                  playbackSpeed={playbackSpeed}
                  setPlaybackSpeed={setPlaybackSpeed}
                  captionsEnabled={captionsEnabled}
                  handleCaptionsToggle={handleCaptionsToggle}
                />
              )}
            </div>

            {isFullScreen ? (
              <ToolTip content={"Exit Fullscreen"}>
                <i
                  onClick={handleFullscreen}
                  className="fa-solid fa-compress"
                  id="controls-btn-fullscreen"
                ></i>
              </ToolTip>
            ) : (
              <ToolTip content={"Fullscreen"}>
                <i
                  onClick={handleFullscreen}
                  className="fa-solid fa-expand"
                  id="controls-btn-fullscreen"
                ></i>
              </ToolTip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
