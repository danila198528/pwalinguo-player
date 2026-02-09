// =====================
// IMPORT REACT
// =====================
import React from 'https://esm.sh/react@18.2.0';
import ReactDOM from 'https://esm.sh/react-dom@18.2.0';

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// =====================
// INDEXED DB
// =====================
const openDB = () =>
    new Promise((resolve, reject) => {
        const request = indexedDB.open('LinguoDB_v3', 1);

        request.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('decks')) {
                db.createObjectStore('decks', { keyPath: 'id' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

const saveDeckToDB = async deck => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('decks', 'readwrite');
        tx.objectStore('decks').put(deck);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
};

const deleteDeckFromDB = async id => {
    const db = await openDB();
    return new Promise(resolve => {
        const tx = db.transaction('decks', 'readwrite');
        tx.objectStore('decks').delete(id);
        tx.oncomplete = resolve;
    });
};

const getDeckFromDB = async id => {
    const db = await openDB();
    return new Promise(resolve => {
        const tx = db.transaction('decks', 'readonly');
        const req = tx.objectStore('decks').get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
};

const getAllStoredIds = async () => {
    const db = await openDB();
    return new Promise(resolve => {
        const tx = db.transaction('decks', 'readonly');
        const req = tx.objectStore('decks').getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve([]);
    });
};

const loadDeckData = async meta => {
    if (!meta.deck_url) return meta;
    try {
        const res = await fetch(meta.deck_url);
        if (!res.ok) throw new Error();
        return await res.json();
    } catch {
        return meta;
    }
};

// =====================
// APP
// =====================
const App = () => {
    const [catalog, setCatalog] = useState([]);
    const [selectedDeck, setSelectedDeck] = useState(null);
    const [audioBlob, setAudioBlob] = useState(null);
    const [downloadedIds, setDownloadedIds] = useState([]);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            setIsLoading(true);
            try {
                const res = await fetch('./catalog.json');
                const data = await res.json();
                setCatalog(Array.isArray(data) ? data : [data]);
            } catch {}
            setDownloadedIds(await getAllStoredIds());
            setIsLoading(false);
        };

        load();

        const online = () => setIsOffline(!navigator.onLine);
        window.addEventListener('online', online);
        window.addEventListener('offline', online);
        return () => {
            window.removeEventListener('online', online);
            window.removeEventListener('offline', online);
        };
    }, []);

    const handleDownload = async meta => {
        setIsDownloading(true);
        try {
            const deck = await loadDeckData(meta);
            const audio = await fetch(deck.audio_url);
            const blob = await audio.blob();

            await saveDeckToDB({
                id: deck.id,
                metadata: deck,
                audioBlob: blob,
            });

            setDownloadedIds(p => [...p, deck.id]);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleSelectDeck = async meta => {
        const stored = await getDeckFromDB(meta.id);
        if (stored) {
            setAudioBlob(stored.audioBlob);
            setSelectedDeck(stored.metadata);
        } else if (!isOffline) {
            setAudioBlob(null);
            setSelectedDeck(await loadDeckData(meta));
        }
    };

    return React.createElement(
        'div',
        { className: 'h-full w-full bg-slate-950 text-slate-100' },

        isLoading
            ? React.createElement('div', null, 'Загрузка…')
            : !selectedDeck
            ? catalog.map(d =>
                  React.createElement(
                      'div',
                      { key: d.id },
                      React.createElement(
                          'button',
                          { onClick: () => handleSelectDeck(d) },
                          d.deck_name
                      ),
                      downloadedIds.includes(d.id)
                          ? '✓'
                          : React.createElement(
                                'button',
                                { onClick: () => handleDownload(d) },
                                'Скачать'
                            )
                  )
              )
            : React.createElement(Player, {
                  deck: selectedDeck,
                  audioBlob,
                  onBack: () => setSelectedDeck(null),
              })
    );
};

// =====================
// PLAYER (STABLE)
// =====================
const Player = ({ deck, audioBlob, onBack }) => {
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [showControls, setShowControls] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [orientation, setOrientation] = useState('portrait');

    const audioRef = useRef(null);
    const containerRef = useRef(null);
    const controlsTimer = useRef(null);
    const [audioUrl, setAudioUrl] = useState('');

    // audio init
    useEffect(() => {
        const url = audioBlob
            ? URL.createObjectURL(audioBlob)
            : deck.audio_url;
        setAudioUrl(url);
        return () => audioBlob && URL.revokeObjectURL(url);
    }, [audioBlob]);

    // orientation (layout only)
    useEffect(() => {
        const update = () =>
            setOrientation(
                window.innerWidth > window.innerHeight
                    ? 'landscape'
                    : 'portrait'
            );
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    // fullscreen (button only)
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
        } catch {}
    };

    useEffect(() => {
        const fs = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', fs);
        return () =>
            document.removeEventListener('fullscreenchange', fs);
    }, []);

    const currentSentence = useMemo(
        () =>
            deck.sentences?.find(
                s => currentTime >= s.start && currentTime <= s.end
            ),
        [currentTime, deck.sentences]
    );

    const show = () => {
        setShowControls(true);
        clearTimeout(controlsTimer.current);
        controlsTimer.current = setTimeout(
            () => setShowControls(false),
            3000
        );
    };

    return React.createElement(
        'div',
        {
            ref: containerRef,
            className: `fixed inset-0 bg-white ${
                orientation === 'landscape'
                    ? 'player-landscape'
                    : 'player-portrait'
            }`,
            onClick: show,
        },

        React.createElement('audio', {
            ref: audioRef,
            src: audioUrl,
            autoPlay: true,
            preload: 'auto',
            onTimeUpdate: e => setCurrentTime(e.target.currentTime),
            onPlay: () => setIsPlaying(true),
            onPause: () => setIsPlaying(false),
        }),

        React.createElement(
            'div',
            null,
            currentSentence?.english || deck.deck_name,
            React.createElement('br'),
            currentSentence?.russian || ''
        ),

        showControls &&
            React.createElement(
                'div',
                null,
                React.createElement('button', { onClick: onBack }, '←'),
                React.createElement(
                    'button',
                    {
                        onClick: () =>
                            isPlaying
                                ? audioRef.current.pause()
                                : audioRef.current.play(),
                    },
                    isPlaying ? '⏸' : '▶'
                ),
                React.createElement(
                    'button',
                    { onClick: toggleFullscreen },
                    isFullscreen ? '⤢' : '⤡'
                )
            )
    );
};

// =====================
// INIT
// =====================
const root = document.getElementById('root');
ReactDOM.createRoot(root).render(React.createElement(App));
