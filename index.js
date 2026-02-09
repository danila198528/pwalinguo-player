// ИМПОРТИРУЕМ REACT
import React from 'https://esm.sh/react@18.2.0';
import ReactDOM from 'https://esm.sh/react-dom@18.2.0';

// --- IndexedDB функции ---
const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('LinguoDB_v3', 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('decks')) {
                db.createObjectStore('decks', { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const saveDeckToDB = async (deck) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('decks', 'readwrite');
        transaction.objectStore('decks').put(deck);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

const deleteDeckFromDB = async (id) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('decks', 'readwrite');
        transaction.objectStore('decks').delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

const getDeckFromDB = async (id) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('decks', 'readonly');
        const request = transaction.objectStore('decks').get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const getAllStoredIds = async () => {
    const db = await openDB();
    return new Promise((resolve) => {
        const transaction = db.transaction('decks', 'readonly');
        const request = transaction.objectStore('decks').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve([]);
    });
};

const loadDeckData = async (deckMeta) => {
    if (deckMeta.deck_url) {
        try {
            const response = await fetch(deckMeta.deck_url);
            if (!response.ok) {
                throw new Error(`Ошибка загрузки: ${response.status}`);
            }
            const fullDeck = await response.json();
            return fullDeck;
        } catch (err) {
            console.error('Ошибка загрузки полной колоды:', err);
            return deckMeta;
        }
    }
    return deckMeta;
};

// --- UI Components ---
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ============================
// APP — НЕ МЕНЯЛСЯ
// ============================
const App = () => {
    const [catalog, setCatalog] = useState([]);
    const [selectedDeck, setSelectedDeck] = useState(null);
    const [activeAudioBlob, setActiveAudioBlob] = useState(null);
    const [downloadedIds, setDownloadedIds] = useState([]);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                const response = await fetch('./catalog.json');
                if (response.ok) {
                    const data = await response.json();
                    setCatalog(Array.isArray(data) ? data : [data]);
                }
            } catch (e) {
                console.error("Catalog load failed", e);
            } finally {
                setIsLoading(false);
            }
            const ids = await getAllStoredIds();
            setDownloadedIds(ids);
        };

        loadData();
        const updateOnlineStatus = () => setIsOffline(!navigator.onLine);
        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
        return () => {
            window.removeEventListener('online', updateOnlineStatus);
            window.removeEventListener('offline', updateOnlineStatus);
        };
    }, []);

    const handleDownload = async (deckMeta) => {
        setIsDownloading(true);
        try {
            const fullDeck = await loadDeckData(deckMeta);
            const audioResponse = await fetch(fullDeck.audio_url);
            const blob = await audioResponse.blob();
            await saveDeckToDB({
                id: fullDeck.id,
                metadata: fullDeck,
                audioBlob: blob
            });
            setDownloadedIds(prev => [...prev, fullDeck.id]);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDelete = async (id) => {
        if (confirm("Удалить из памяти устройства?")) {
            await deleteDeckFromDB(id);
            setDownloadedIds(prev => prev.filter(i => i !== id));
        }
    };

    const handleSelectDeck = async (deckMeta) => {
        const stored = await getDeckFromDB(deckMeta.id);
        if (stored) {
            setActiveAudioBlob(stored.audioBlob);
            setSelectedDeck(stored.metadata);
        } else if (!isOffline) {
            const fullDeck = await loadDeckData(deckMeta);
            setActiveAudioBlob(null);
            setSelectedDeck(fullDeck);
        }
    };

    return React.createElement(
        "div",
        { className: "h-full w-full bg-slate-950 text-slate-100 flex flex-col" },
        isLoading
            ? React.createElement("div", null, "Загрузка…")
            : !selectedDeck
            ? catalog.map(deckMeta =>
                React.createElement("div", { key: deckMeta.id },
                    deckMeta.deck_name,
                    downloadedIds.includes(deckMeta.id)
                        ? React.createElement("button", { onClick: () => handleDelete(deckMeta.id) }, "🗑️")
                        : React.createElement("button", { onClick: () => handleDownload(deckMeta) }, "Скачать"),
                    React.createElement("button", { onClick: () => handleSelectDeck(deckMeta) }, "▶")
                )
            )
            : React.createElement(Player, {
                deck: selectedDeck,
                audioBlob: activeAudioBlob,
                onBack: () => setSelectedDeck(null)
            })
    );
};

// ============================
// PLAYER — ИСПРАВЛЕН
// ============================
const Player = ({ deck, audioBlob, onBack }) => {
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [showControls, setShowControls] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const audioRef = useRef(null);
    const containerRef = useRef(null);
    const controlsTimeout = useRef(null);
    const hasStartedRef = useRef(false);

    // ---------- AUDIO INIT (БЕЗ autoPlay-петли) ----------
    const audioUrl = useMemo(() => {
        return audioBlob
            ? URL.createObjectURL(audioBlob)
            : deck.audio_url;
    }, [audioBlob, deck.audio_url]);

    useEffect(() => {
        return () => {
            if (audioBlob) URL.revokeObjectURL(audioUrl);
        };
    }, [audioBlob, audioUrl]);

    // ---------- ОДНОРАЗОВЫЙ СТАРТ ----------
    useEffect(() => {
        if (!audioRef.current || hasStartedRef.current) return;

        hasStartedRef.current = true;
        audioRef.current.play().catch(() => {});
    }, []);

    // ---------- AUDIO EVENTS ----------
    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    const togglePlay = useCallback(() => {
        if (!audioRef.current) return;

        if (audioRef.current.paused) {
            audioRef.current.play().catch(() => {});
        } else {
            audioRef.current.pause();
        }
    }, []);

    const handlePrevious = useCallback(() => {
        if (!deck.sentences || !audioRef.current) return;

        const idx = deck.sentences.findIndex(
            s => currentTime >= s.start && currentTime <= s.end
        );

        if (idx === -1) return;

        audioRef.current.currentTime =
            currentTime - deck.sentences[idx].start > 2
                ? deck.sentences[idx].start
                : deck.sentences[Math.max(0, idx - 1)].start;
    }, [currentTime, deck.sentences]);

    // ---------- FULLSCREEN (ТОЛЬКО КНОПКА) ----------
    const toggleFullscreen = async () => {
        try {
            if (!document.fullscreenElement) {
                await containerRef.current.requestFullscreen();
                try {
                    await screen.orientation?.lock('landscape');
                } catch {}
            } else {
                screen.orientation?.unlock?.();
                await document.exitFullscreen();
            }
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        const handler = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    // ---------- UI ----------
    const currentSentence = useMemo(() => {
        return deck.sentences?.find(
            s => currentTime >= s.start && currentTime <= s.end
        );
    }, [currentTime, deck.sentences]);

    const handleScreenTouch = () => {
        setShowControls(true);
        clearTimeout(controlsTimeout.current);
        controlsTimeout.current = setTimeout(() => {
            setShowControls(false);
        }, 3000);
    };

    return React.createElement(
        "div",
        {
            ref: containerRef,
            className: "fixed inset-0 bg-white flex flex-col z-60 overflow-hidden",
            onClick: handleScreenTouch
        },

        React.createElement("audio", {
            ref: audioRef,
            src: audioUrl,
            preload: "auto",
            onTimeUpdate: handleTimeUpdate,
            onPlay: () => setIsPlaying(true),
            onPause: () => setIsPlaying(false)
        }),

        React.createElement("div", { className: "flex-1 flex flex-col items-center justify-center p-8 text-center" },
            React.createElement("div", { className: "english-text text-black mb-4" },
                currentSentence?.english || deck.deck_name
            ),
            React.createElement("div", { className: "russian-text text-gray-600" },
                currentSentence?.russian || ""
            )
        ),

        showControls && React.createElement("div", { className: "fixed inset-0 z-50" },
            React.createElement("button", { onClick: onBack }, "←"),
            React.createElement("button", { onClick: handlePrevious }, "⏮"),
            React.createElement("button", { onClick: togglePlay }, isPlaying ? "⏸" : "▶"),
            React.createElement("button", { onClick: toggleFullscreen }, isFullscreen ? "⤢" : "⤡")
        )
    );
};

// ============================
// INIT
// ============================
const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(React.createElement(App));
}
