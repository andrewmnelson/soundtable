import { useRef, useState } from "react";
import "./App.css";

type AudioKind = "mp3" | "ogg";

type SoundFile = {
  id: string;
  originalName: string;
  displayName: string;
  duration: string;
  extension: AudioKind;
  path: string;
  fileHandle: FileSystemFileHandle;
  parentDirectory: FileSystemDirectoryHandle;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

function extensionOf(filename: string): AudioKind | null {
  const extension = filename.split(".").pop()?.toLowerCase();

  return extension === "mp3" || extension === "ogg" ? extension : null;
}

function nameWithoutExtension(filename: string): string {
  return filename.replace(/\.(mp3|ogg)$/i, "");
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secondsRemaining = totalSeconds % 60;

  return [hours, minutes, secondsRemaining]
    .map((unit) => String(unit).padStart(2, "0"))
    .join(":")
    .replace(/^00:/, "");
}

async function readDuration(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  const url = URL.createObjectURL(file);
  const audio = new Audio();

  return new Promise((resolve) => {
    const cleanup = () => URL.revokeObjectURL(url);

    audio.addEventListener(
      "loadedmetadata",
      () => {
        const duration = Number.isFinite(audio.duration)
          ? formatDuration(audio.duration)
          : "—";
        cleanup();
        resolve(duration);
      },
      { once: true },
    );

    audio.addEventListener(
      "error",
      () => {
        cleanup();
        resolve("—");
      },
      { once: true },
    );

    audio.src = url;
  });
}

async function collectSoundFiles(
  directory: FileSystemDirectoryHandle,
  parentPath = "",
): Promise<SoundFile[]> {
  const sounds: SoundFile[] = [];

  for await (const [entryName, entry] of directory.entries()) {
    const path = parentPath ? `${parentPath}/${entryName}` : entryName;

    if (entry.kind === "directory") {
      sounds.push(...(await collectSoundFiles(entry, path)));
      continue;
    }

    const extension = extensionOf(entryName);

    if (!extension) {
      continue;
    }

    sounds.push({
      id: path,
      originalName: entryName,
      displayName: nameWithoutExtension(entryName),
      duration: "...",
      fileHandle: entry as FileSystemFileHandle,
      parentDirectory: directory,
      extension,
      path,
    });
  }

  return sounds;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...items];
  const [movedItem] = result.splice(fromIndex, 1);

  result.splice(toIndex, 0, movedItem);
  return result;
}

function SoundCard({
  sound,
  onPlay,
  onRename,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  sound: SoundFile;
  onPlay: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(sound.displayName);

  const clickTimerRef = useRef<number | null>(null);

  function handleCardClick() {
    if (editing) return;
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
    } 
    clickTimerRef.current = window.setTimeout(() => {
      onPlay(sound);
      clickTimerRef.current = null;
    }, 250);
  }

  function handleCardNameDoubleClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (editing) return;

    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    beginEditing();
  }

  function beginEditing() {
    setDraftName(sound.displayName);
    setEditing(true);
  }

  function finishEditing() {
    const newName = draftName.trim();

    if (newName && newName !== sound.displayName) {
      onRename(sound.id, newName);
    }

    setEditing(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      finishEditing();
    }

    if (event.key === "Escape") {
      setDraftName(sound.displayName);
      setEditing(false);
    }
  }

  return (
    <div
      className={`sound-card ${sound.extension}`}
      draggable={!editing}
      onDragStart={() => onDragStart(sound.id)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(sound.id)}
      onClick={handleCardClick}
      title={`${sound.path} — drag to reorder`}
    >
      <div className="sound-card-header">
        <span className="duration">{sound.duration}</span>
        <span className="file-type">{sound.extension.toLowerCase()}</span>
      </div>

      {editing ? (
        <input
          autoFocus
          className="name-input"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={finishEditing}
          onKeyDown={handleKeyDown}
          aria-label={`Rename ${sound.displayName}`}
        />
      ) : (
        <button
          type="button"
          className="sound-name"
          onDoubleClick={handleCardNameDoubleClick}
          title="Click to play; double-click to rename"
        >
          {sound.displayName}
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [sounds, setSounds] = useState<SoundFile[]>([]);
  const [directoryName, setDirectoryName] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [status, setStatus] = useState("Choose a directory to begin.");
  const [isScanning, setIsScanning] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  async function chooseDirectory() {
    const pickerWindow = window as DirectoryPickerWindow;

    if (!pickerWindow.showDirectoryPicker) {
      setStatus(
        "Directory picking is not supported in this browser. Try a Chromium-based browser.",
      );
      return;
    }

    try {
      setIsScanning(true);
      setStatus("Scanning directory...");

      const directory = await pickerWindow.showDirectoryPicker();
      const foundSounds = await collectSoundFiles(directory);

      const soundsWithDurations = await Promise.all(
        foundSounds.map(async (sound) => ({
          ...sound,
          duration: await readDuration(sound.fileHandle),
        })),
      );

      setSounds(soundsWithDurations);
      setDirectoryName(directory.name);
      setStatus(
        foundSounds.length === 1
          ? "1 sound found."
          : `${foundSounds.length} sounds found.`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Directory selection cancelled.");
      } else {
        setStatus("Could not read the selected directory.");
        console.error(error);
      }
    } finally {
      setIsScanning(false);
    }
  }

  async function playSound(sound: SoundFile) {
    try {
      audioRef.current?.pause();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      const file = await sound.fileHandle.getFile();
      const audioUrl = URL.createObjectURL(file);
      const audio = new Audio(audioUrl);

      audio.addEventListener("ended", () => {
          URL.revokeObjectURL(objectUrlRef.current);
          if (objectUrlRef.current === audioUrl) objectUrlRef.current = null;
        },
        { once: true }
      );

      audioRef.current = audio;
      objectUrlRef.current = audioUrl;
      await audio.play();
    } catch (error) {
      console.error("Error playing sound:", error);
    }
  }

  async function renameSound(id: string, displayName: string) {
    const sound = sounds.find((item) => item.id === id);
    if (!sound) return;
    const newBaseName = displayName.trim();
    if (!newBaseName) throw new Error("Name cannot be empty.");

    const newFilename = `${newBaseName}.${sound.extension}`;
    if (newFilename === sound.originalName) return;

    // Don't overwrite existing file
    try { console.log("Checking directory for sound: ",sound);
      await sound.parentDirectory.getFileHandle(newFilename, { create: false });
      throw new Error(`The file '${newFilename}' already exists.`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) {
        throw error;
      }
    }

    const oldFile = await sound.fileHandle.getFile();
    const newHandle = await sound.parentDirectory.getFileHandle(newFilename, { create: true });

    try {
      const writable = await newHandle.createWritable();
      await writable.write(oldFile);
      await writable.close();

      await sound.parentDirectory.removeEntry(sound.originalName);
    } catch (error) {
      // clean up the debris if rename went wrong
      await sound.parentDirectory.removeEntry(newFilename).catch(() => {});
      throw error;
    }

    setSounds((currentSounds) =>
      currentSounds.map((sound) =>
        sound.id === id ? {
          ...sound,
          displayName: newBaseName,
          originalName: newFilename,
          path: sound.path.replace(/[^/]+$/, newFilename),
          fileHandle: newHandle,
        } : sound,
      ),
    );
  }

  function handleDragStart(id: string) {
    setDraggedId(id);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }

    const fromIndex = sounds.findIndex((sound) => sound.id === draggedId);
    const toIndex = sounds.findIndex((sound) => sound.id === targetId);

    if (fromIndex !== -1 && toIndex !== -1) {
      setSounds((currentSounds) =>
        moveItem(currentSounds, fromIndex, toIndex),
      );
    }

    setDraggedId(null);
  }

  return (
    <main className="app">
      <header className="toolbar">
        <div>
          <h1>Soundtable</h1>
          <p className="status">
            {directoryName ? `${directoryName} · ${status}` : status}
          </p>
        </div>

        <button
          type="button"
          className="choose-button"
          onClick={chooseDirectory}
          disabled={isScanning}
        >
          {isScanning ? "Scanning..." : "Choose directory"}
        </button>
      </header>

      {sounds.length > 0 ? (
        <section className="sound-grid" aria-label="Sound files">
          {sounds.map((sound) => (
            <SoundCard
              key={sound.id}
              sound={sound}
              onPlay={playSound}
              onRename={renameSound}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
          ))}
        </section>
      ) : (
        <section className="empty-state">
          <p>No MP3 or OGG files to display.</p>
        </section>
      )}
    </main>
  );
}
