import { useEffect, useRef, useState } from "react";
import { readPhoto } from "../api";
import { prepareScoreboardPhoto } from "../image";

/*
 * Pick or shoot a photo of the recap screen, shrink it in the browser, and
 * ask the API to read it. The read is handed up to the form for review.
 * Nothing is saved from here.
 */
const PhotoReader = ({ getToken, onRead, onUnavailable }) => {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | reading | done | error
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  // Revoke the object URL when it's replaced or on unmount.
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setStatus("reading");
    try {
      const photo = await prepareScoreboardPhoto(file);
      setPreview(photo.previewUrl);
      const result = await readPhoto(getToken, photo);
      if (!result.ok) {
        setStatus("error");
        setError(result.error);
        if (result.code === "vision_unconfigured") onUnavailable();
        return;
      }
      if (!result.read.readable) {
        setStatus("error");
        setError("Couldn't find any bowlers in that photo. Try a straighter shot of the recap screen.");
        return;
      }
      setStatus("done");
      onRead(result.read);
    } catch (err) {
      setStatus("error");
      setError(err.message || "Couldn't read that photo.");
    }
  }

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  };

  return (
    <div className="bw-photo">
      <label
        className={`bw-drop ${dragging ? "is-drag" : ""} ${status === "reading" ? "is-busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={status === "reading"}
          onChange={(e) => {
            handleFile(e.target.files && e.target.files[0]);
            e.target.value = "";
          }}
        />
        {preview ? (
          <img src={preview} alt="The scoreboard you uploaded" className="bw-drop-preview" />
        ) : (
          <span className="bw-drop-ball" aria-hidden="true" />
        )}
        <span className="bw-drop-copy">
          {status === "reading" ? (
            <>
              <strong>Reading the lanes</strong>
              <span>Picking out names and games</span>
            </>
          ) : (
            <>
              <strong>{preview ? "Try another photo" : "Snap the recap screen"}</strong>
              <span>Tap to take or choose a photo, or drop one here</span>
            </>
          )}
        </span>
        {status === "reading" && (
          <span className="bw-roll" aria-hidden="true">
            <span className="bw-roll-track">
              <span className="bw-roll-ball" />
            </span>
          </span>
        )}
      </label>

      <p className="bw-photo-note" role={error ? "alert" : undefined}>
        {error ? (
          <span className="bw-error">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" /> {error}
          </span>
        ) : status === "done" ? (
          <span>
            <i className="fa-solid fa-circle-check" aria-hidden="true" /> Read it. Check the
            numbers below, then save.
          </span>
        ) : (
          "Photos are shrunk on your device and never stored. Only the scores you save are kept."
        )}
      </p>
    </div>
  );
};

export default PhotoReader;
