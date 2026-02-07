// ИМПОРТИРУЕМ REACT
import React from 'https://esm.sh/react@18.2.0';
import ReactDOM from 'https://esm.sh/react-dom@18.2.0';

// --- Types ---
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

// --- НОВАЯ ФУНКЦИЯ: Загрузка полных данных колоды ---
const loadDeckData = async (deckMeta) => {
    // Если есть deck_url — загружаем раздельно (новый формат)
    if (deckMeta.deck_url) {
        try {
            console.log('Загружаем полную колоду:', deckMeta.deck_url);
            const response = await fetch(deckMeta.deck_url);
            if (!response.ok) {
                throw new Error(`Ошибка загрузки: ${response.status}`);
            }
            const fullDeck = await response.json();
            return fullDeck;
        } catch (err) {
            console.error('Ошибка загрузки полной колоды:', err);
            // Если не удалось загрузить отдельно, используем meta как fallback
            return deckMeta;
        }
    }
    // Иначе используем старый формат (данные уже в meta)
    return deckMeta;
};

// --- UI Components ---
const { useState, useEffect, useRef, useMemo } = React;

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
                console.log('Загружаем каталог...');
                const response = await fetch('./catalog.json');
                if (response.ok) {
                    const data = await response.json();
                    setCatalog(Array.isArray(data) ? data : [data]);
                    console.log('Каталог загружен, колод:', data.length);
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

    // --- ОБНОВЛЕННАЯ ФУНКЦИЯ СКАЧИВАНИЯ ---
    const handleDownload = async (deckMeta) => {
        setIsDownloading(true);
        
        try {
            console.log('Начинаем скачивание:', deckMeta.deck_name);
            
            // 1. Загружаем полные данные колоды
            const fullDeck = await loadDeckData(deckMeta);
            console.log('Полные данные загружены, предложений:', fullDeck.sentences?.length);
            
            // 2. Скачиваем аудио
            console.log('Скачиваем аудио:', fullDeck.audio_url);
            const audioResponse = await fetch(fullDeck.audio_url);
            
            if (!audioResponse.ok) {
                throw new Error(`Ошибка аудио: ${audioResponse.status}`);
            }
            
            const blob = await audioResponse.blob();
            console.log('Аудио скачано, размер:', blob.size, 'байт');
            
            if (blob.size === 0) {
                throw new Error("Пустой аудиофайл");
            }
            
            // 3. Сохраняем ПОЛНЫЕ данные в IndexedDB
            console.log('Сохраняем в базу...');
            await saveDeckToDB({
                id: fullDeck.id,
                metadata: fullDeck,  // Сохраняем полную колоду
                audioBlob: blob
            });
            
            // 4. Обновляем UI
            setDownloadedIds(prev => [...prev, fullDeck.id]);
            
            console.log('Скачивание успешно завершено!');
            alert("✅ Колода успешно скачана!");
            
        } catch (err) {
            console.error('❌ Ошибка скачивания:', err);
            alert(`❌ Ошибка скачивания: ${err.message}`);
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

    // --- ОБНОВЛЕННАЯ ФУНКЦИЯ ВЫБОРА КОЛОДЫ ---
    const handleSelectDeck = async (deckMeta) => {
        console.log('Выбрана колода:', deckMeta.deck_name);
        
        // Проверяем, есть ли в IndexedDB
        const stored = await getDeckFromDB(deckMeta.id);
        
        if (stored) {
            // Используем сохранённые данные
            console.log('Используем сохранённую колоду');
            setActiveAudioBlob(stored.audioBlob);
            setSelectedDeck(stored.metadata);
        } else if (!isOffline) {
            // Загружаем полные данные для онлайн-воспроизведения
            console.log('Загружаем для онлайн-воспроизведения');
            try {
                const fullDeck = await loadDeckData(deckMeta);
                setActiveAudioBlob(null);
                setSelectedDeck(fullDeck);
            } catch (err) {
                console.error('Ошибка загрузки колоды:', err);
                alert('Не удалось загрузить колоду');
            }
        } else {
            alert("Нет подключения к сети");
        }
    };

    return React.createElement("div", { className: "h-full w-full bg-slate-950 text-slate-100 flex flex-col" },
        isOffline && React.createElement("div", { className: "bg-red-900/80 text-10 text-center py-1 font-black uppercase z-50" }, "Офлайн"),
        
        isLoading ? React.createElement("div", { className: "flex-1 flex items-center justify-center" },
            React.createElement("div", { className: "text-center" },
                React.createElement("div", { className: "w-14 h-14 border-t-4 border-blue-500 rounded-full animate-spin mb-6 mx-auto shadow-blue-glow" }),
                React.createElement("p", { className: "font-black text-xl tracking-tight" }, "ЗАГРУЖАЕМ КАТАЛОГ"),
                React.createElement("p", { className: "text-slate-500 text-sm mt-1" }, "Подождите немного...")
            )
        ) : !selectedDeck ? React.createElement("div", { className: "flex-1 overflow-y-auto p-4 pb-20" },
            React.createElement("header", { className: "my-8 text-center" },
                React.createElement("h1", { className: "text-3xl font-black tracking-tighter italic" }, "LINGUO", React.createElement("span", { className: "text-blue-500" }, "PLAYER")),
                React.createElement("p", { className: "text-slate-500 text-xs mt-1 font-medium uppercase tracking-widest" }, "v1.0.0 Stable")
            ),
            React.createElement("div", { className: "grid gap-3" }, catalog.map(deckMeta =>
                React.createElement("div", { key: deckMeta.id, className: "bg-slate-900/50 border border-slate-800 p-4 rounded-2xl flex justify-between items-center backdrop-blur-sm" },
                    React.createElement("div", { className: "flex-1 cursor-pointer", onClick: () => handleSelectDeck(deckMeta) },
                        React.createElement("h3", { className: "font-bold text-slate-200" }, deckMeta.deck_name),
                        React.createElement("div", { className: "flex gap-3 mt-2" },
                            React.createElement("span", { className: "text-10 text-slate-500 bg-slate-800 px-2 py-0.5 rounded uppercase font-bold" }, deckMeta.total_sentences + " фразы"),
                            React.createElement("span", { className: "text-10 text-slate-500 bg-slate-800 px-2 py-0.5 rounded uppercase font-bold" }, "~" + (deckMeta.total_duration / 60).toFixed(0) + " мин")
                        )
                    ),
                    React.createElement("div", { className: "ml-4" },
                        downloadedIds.includes(deckMeta.id) ?
                            React.createElement("button", { onClick: () => handleDelete(deckMeta.id), className: "w-10 h-10 flex items-center justify-center bg-slate-800 rounded-full text-lg active:scale-90 transition-transform" }, "🗑️") :
                            React.createElement("button", {
                                disabled: isDownloading || isOffline,
                                onClick: () => handleDownload(deckMeta),
                                className: "bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl text-10 font-black uppercase tracking-wider disabled:opacity-20 active:scale-95 transition-all"
                            }, isDownloading ? '...' : 'Скачать')
                    )
                )
            ))
        ) : React.createElement(Player, { deck: selectedDeck, audioBlob: activeAudioBlob, onBack: () => setSelectedDeck(null) }),
        
        isDownloading && React.createElement("div", { className: "fixed inset-0 bg-slate-950/90 flex flex-col items-center justify-center z-100 backdrop-blur-md" },
            React.createElement("div", { className: "w-14 h-14 border-t-4 border-blue-500 rounded-full animate-spin mb-6 shadow-blue-glow" }),
            React.createElement("p", { className: "font-black text-xl tracking-tight" }, "СОХРАНЯЕМ КОЛОДУ"),
            React.createElement("p", { className: "text-slate-500 text-sm mt-1" }, "Осталось совсем немного...")
        )
    );
};

const Player = ({ deck, audioBlob, onBack }) => {
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef(null);
    const [audioUrl, setAudioUrl] = useState('');

    useEffect(() => {
        const url = audioBlob ? URL.createObjectURL(audioBlob) : deck.audio_url;
        setAudioUrl(url);
        return () => { if (audioBlob) URL.revokeObjectURL(url); };
    }, [deck.id, audioBlob]);

    const currentSentence = useMemo(() => {
        return deck.sentences?.find(s => currentTime >= s.start && currentTime <= s.end);
    }, [currentTime, deck.sentences]);

    const handleTimeUpdate = () => {
        if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
    };

    const togglePlay = () => {
        if (isPlaying) audioRef.current?.pause();
        else audioRef.current?.play();
    };

    return React.createElement("div", { className: "fixed inset-0 bg-slate-950 flex flex-col z-60 overflow-hidden" },
        React.createElement("div", { className: "p-4 flex items-center justify-between border-b border-white/5 bg-slate-900/30" },
            React.createElement("button", { onClick: onBack, className: "w-10 h-10 flex items-center justify-center bg-slate-800 rounded-full text-xl active:scale-90 transition-transform" }, "←"),
            React.createElement("div", { className: "flex-1 px-4 text-center" },
                React.createElement("span", { className: "block text-9 uppercase tracking-widest font-black text-blue-500 mb-0.5" }, "Playing"),
                React.createElement("span", { className: "block text-xs font-bold truncate opacity-80" }, deck.deck_name)
            ),
            React.createElement("div", { className: "w-10" })
        ),
        React.createElement("div", { className: "flex-1 flex flex-col items-center justify-center p-8 text-center relative" },
            React.createElement("div", { className: "absolute inset-0 from-blue-600/5 pointer-events-none" }),
            React.createElement("div", { className: "max-w-xl w-full relative z-10" },
                React.createElement("div", { className: "text-3xl md:text-5xl font-black mb-10 leading-1.15 min-h-4.5em flex items-center justify-center text-white drop-shadow-2xl" }, currentSentence?.english || ""),
                React.createElement("div", { className: "text-lg md:text-xl text-slate-500 font-medium leading-relaxed min-h-3em flex items-center justify-center italic" }, currentSentence?.russian || "")
            )
        ),
        React.createElement("div", { className: "p-8 pb-14 bg-slate-900/50 backdrop-blur-xl border-t border-white/5 rounded-t-40" },
            React.createElement("audio", {
                ref: audioRef,
                src: audioUrl,
                onTimeUpdate: handleTimeUpdate,
                onPlay: () => setIsPlaying(true),
                onPause: () => setIsPlaying(false),
                autoPlay: true
            }),
            React.createElement("div", { className: "mb-10 px-2" },
                React.createElement("div", {
                    className: "w-full h-2 bg-slate-800 rounded-full relative cursor-pointer overflow-hidden shadow-inner",
                    onClick: (e) => {
                        if (!audioRef.current) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pos = (e.clientX - rect.left) / rect.width;
                        audioRef.current.currentTime = pos * audioRef.current.duration;
                    }
                },
                    React.createElement("div", {
                        className: "absolute top-0 left-0 h-full bg-blue-500 shadow-blue-glow transition-all duration-100",
                        style: { width: `${(currentTime / (audioRef.current?.duration || 1)) * 100}%` }
                    })
                ),
                React.createElement("div", { className: "flex justify-between mt-3 text-10 font-black text-slate-600 uppercase tracking-tighter" },
                    React.createElement("span", null, currentTime.toFixed(0) + "s"),
                    React.createElement("span", null, (audioRef.current?.duration || 0).toFixed(0) + "s")
                )
            ),
            React.createElement("div", { className: "flex justify-around items-center" },
                React.createElement("button", {
                    onClick: () => { if (audioRef.current) audioRef.current.currentTime -= 5 },
                    className: "w-12 h-12 rounded-full flex items-center justify-center text-slate-400 font-black text-xs active:bg-slate-800 transition-all"
                }, "-5S"),
                React.createElement("button", {
                    onClick: togglePlay,
                    className: "w-24 h-24 bg-white text-slate-950 rounded-35 flex items-center justify-center text-4xl shadow-white-glow active:scale-90 transition-transform"
                }, isPlaying ? '⏸' : '▶'),
                React.createElement("button", {
                    onClick: () => { if (audioRef.current) audioRef.current.currentTime += 5 },
                    className: "w-12 h-12 rounded-full flex items-center justify-center text-slate-400 font-black text-xs active:bg-slate-800 transition-all"
                }, "+5S")
            )
        )
    );
};

// Инициализация приложения
const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(React.createElement(App));
}