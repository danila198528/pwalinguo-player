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
            
            if (!audioResponse.ok) {
                throw new Error(`Ошибка аудио: ${audioResponse.status}`);
            }
            
            const blob = await audioResponse.blob();
            
            if (blob.size === 0) {
                throw new Error("Пустой аудиофайл");
            }
            
            await saveDeckToDB({
                id: fullDeck.id,
                metadata: fullDeck,
                audioBlob: blob
            });
            
            setDownloadedIds(prev => [...prev, fullDeck.id]);
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

    const handleSelectDeck = async (deckMeta) => {
        const stored = await getDeckFromDB(deckMeta.id);
        
        if (stored) {
            setActiveAudioBlob(stored.audioBlob);
            setSelectedDeck(stored.metadata);
        } else if (!isOffline) {
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
                React.createElement("div", { className: "w-14 h-14 border-t-4 border-blue-500 rounded-full animate-spin mb-6 mx-auto" }),
                React.createElement("p", { className: "font-black text-xl tracking-tight" }, "ЗАГРУЖАЕМ КАТАЛОГ"),
                React.createElement("p", { className: "text-slate-500 text-sm mt-1" }, "Подождите немного...")
            )
        ) : !selectedDeck ? React.createElement("div", { className: "flex-1 overflow-y-auto p-4 pb-20" },
            React.createElement("header", { className: "my-8 text-center" },
                React.createElement("h1", { className: "text-3xl font-black tracking-tighter italic" }, "LINGUO", React.createElement("span", { className: "text-blue-500" }, "PLAYER")),
                React.createElement("p", { className: "text-slate-500 text-xs mt-1 font-medium uppercase tracking-widest" }, "v1.0.0 Stable")
            ),
            React.createElement("div", { className: "grid gap-3" }, catalog.map(deckMeta =>
                React.createElement("div", { key: deckMeta.id, className: "bg-slate-900/50 border border-slate-800 p-4 rounded-2xl flex justify-between items-center" },
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
            React.createElement("div", { className: "w-14 h-14 border-t-4 border-blue-500 rounded-full animate-spin mb-6" }),
            React.createElement("p", { className: "font-black text-xl tracking-tight" }, "СОХРАНЯЕМ КОЛОДУ"),
            React.createElement("p", { className: "text-slate-500 text-sm mt-1" }, "Осталось совсем немного...")
        )
    );
};

const Player = ({ deck, audioBlob, onBack }) => {
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [showControls, setShowControls] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const audioRef = useRef(null);
    const [audioUrl, setAudioUrl] = useState('');
    const controlsTimeout = useRef(null);

    // Инициализация аудио
    useEffect(() => {
        const url = audioBlob ? URL.createObjectURL(audioBlob) : deck.audio_url;
        setAudioUrl(url);
        return () => { if (audioBlob) URL.revokeObjectURL(url); };
    }, [deck.id, audioBlob]);

    // Текущее предложение
    const currentSentence = useMemo(() => {
        return deck.sentences?.find(s => currentTime >= s.start && currentTime <= s.end);
    }, [currentTime, deck.sentences]);

    // Обработчики аудио
    const handleTimeUpdate = () => {
        if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
    };

    const togglePlay = () => {
        if (!audioRef.current) return;
        
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            if (audioRef.current.readyState >= 2) {
                audioRef.current.play().catch(err => {
                    console.error('Play error:', err);
                    setIsPlaying(false);
                });
            } else {
                audioRef.current.oncanplay = () => {
                    audioRef.current.play().catch(err => {
                        console.error('Play error:', err);
                        setIsPlaying(false);
                    });
                };
            }
        }
    };

    const handlePrevious = () => {
        if (!audioRef.current || !deck.sentences) return;
        
        const currentIndex = deck.sentences.findIndex(s => currentTime >= s.start && currentTime <= s.end);
        
        if (currentIndex === -1) return;
        
        if (currentTime - deck.sentences[currentIndex]?.start > 2) {
            audioRef.current.currentTime = deck.sentences[currentIndex].start;
        } else if (currentIndex > 0) {
            audioRef.current.currentTime = deck.sentences[currentIndex - 1].start;
        }
    };

    // Полноэкранный режим
    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            // Вход в полноэкранный режим
            document.documentElement.requestFullscreen().then(() => {
                // Блокируем ориентацию на landscape
                if (screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock('landscape').catch(err => {
                        console.log('Orientation lock error:', err);
                    });
                }
            }).catch(err => {
                console.log('Fullscreen error:', err);
            });
        } else {
            // Выход из полноэкранного режима
            document.exitFullscreen().then(() => {
                // Принудительно разблокируем ориентацию
                if (screen.orientation && screen.orientation.unlock) {
                    screen.orientation.unlock();
                }
            });
        }
    };

    // Слушатель полноэкранного режима
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
            
            // Разблокируем ориентацию при выходе из fullscreen
            if (!document.fullscreenElement && screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        };

        // Обработчик кнопки "Назад" на Android
        const handleBackButton = (e) => {
            if (document.fullscreenElement) {
                e.preventDefault();
                document.exitFullscreen().then(() => {
                    if (screen.orientation && screen.orientation.unlock) {
                        screen.orientation.unlock();
                    }
                });
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('backbutton', handleBackButton);
        
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('backbutton', handleBackButton);
        };
    }, []);

    // Управление контролами
    const handleScreenTouch = () => {
        setShowControls(true);
        
        if (controlsTimeout.current) {
            clearTimeout(controlsTimeout.current);
        }
        
        controlsTimeout.current = setTimeout(() => {
            setShowControls(false);
        }, 3000);
    };

    // Горячие клавиши
    useEffect(() => {
        const handleKeyPress = (e) => {
            if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                togglePlay();
            }
            if (e.key === 'ArrowLeft') handlePrevious();
            if (e.key === 'f' || e.key === 'F') toggleFullscreen();
            if (e.key === 'Escape') {
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else if (showControls) {
                    setShowControls(false);
                }
            }
        };

        document.addEventListener('keydown', handleKeyPress);
        return () => document.removeEventListener('keydown', handleKeyPress);
    }, [isPlaying, showControls]);

    // Очистка таймеров
    useEffect(() => {
        return () => {
            if (controlsTimeout.current) {
                clearTimeout(controlsTimeout.current);
            }
        };
    }, []);

    return React.createElement("div", { 
        className: "fixed inset-0 bg-white flex flex-col z-60 overflow-hidden",
        onClick: handleScreenTouch
    },
        // Аудио элемент
        React.createElement("audio", {
            ref: audioRef,
            src: audioUrl,
            onTimeUpdate: handleTimeUpdate,
            onPlay: () => setIsPlaying(true),
            onPause: () => setIsPlaying(false),
            onError: (e) => console.error('Audio error:', e),
            preload: "auto",
            autoPlay: true
        }),

        // Основной контент
        React.createElement("div", { className: "flex-1 flex flex-col items-center justify-center p-8 text-center" },
            // Английский текст
            React.createElement("div", { 
                className: "text-5xl md:text-6xl font-normal leading-tight text-black mb-4"
            }, 
                currentSentence?.english || deck.deck_name
            ),
            
            // Русский текст
            React.createElement("div", { 
                className: "text-2xl md:text-3xl text-gray-600 font-normal leading-relaxed mt-32"
            }, 
                currentSentence?.russian || ""
            )
        ),

        // Контролы плеера (появляются при касании)
        showControls && React.createElement("div", { 
            className: "fixed inset-0 z-50"
        },
            // Верхняя панель (кнопка назад в меню)
            React.createElement("div", { className: "absolute top-6 left-6" },
                React.createElement("button", {
                    onClick: onBack,
                    className: "w-12 h-12 rounded-full flex items-center justify-center text-black bg-white shadow-lg hover:bg-gray-100 active:scale-90 transition-all border border-gray-200"
                }, "←")
            ),
            
            // Центральные контролы
            React.createElement("div", { className: "absolute bottom-6 left-0 right-0 flex items-center justify-center gap-12" },
                // Кнопка назад на предыдущий субтитр
                React.createElement("button", {
                    onClick: handlePrevious,
                    className: "w-14 h-14 rounded-full flex items-center justify-center text-black bg-white shadow-lg hover:bg-gray-100 active:scale-90 transition-all border border-gray-200"
                }, "⏮"),
                
                // Кнопка паузы/воспроизведения
                React.createElement("button", {
                    onClick: togglePlay,
                    className: "w-20 h-20 bg-black rounded-full flex items-center justify-center text-3xl text-white shadow-lg hover:scale-105 active:scale-95 transition-all"
                }, isPlaying ? '⏸' : '▶'),
                
                // Кнопка полноэкранного режима
                React.createElement("button", {
                    onClick: toggleFullscreen,
                    className: "w-14 h-14 rounded-full flex items-center justify-center text-black bg-white shadow-lg hover:bg-gray-100 active:scale-90 transition-all border border-gray-200"
                }, isFullscreen ? '⤢' : '⤡')
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