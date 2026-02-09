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
    const [isLandscapeForced, setIsLandscapeForced] = useState(false);
    const [currentOrientation, setCurrentOrientation] = useState('portrait');
    const audioRef = useRef(null);
    const [audioUrl, setAudioUrl] = useState('');
    const controlsTimeout = useRef(null);
    const containerRef = useRef(null);

    // Инициализация аудио
    useEffect(() => {
        const url = audioBlob ? URL.createObjectURL(audioBlob) : deck.audio_url;
        setAudioUrl(url);
        return () => { if (audioBlob) URL.revokeObjectURL(url); };
    }, [deck.id, audioBlob]);

    // Определяем текущую ориентацию
    const detectOrientation = useCallback(() => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const orientation = width > height ? 'landscape' : 'portrait';
        setCurrentOrientation(orientation);
        return orientation;
    }, []);

    // Текущее предложение
    const currentSentence = useMemo(() => {
        return deck.sentences?.find(s => currentTime >= s.start && currentTime <= s.end);
    }, [currentTime, deck.sentences]);

    // Обработчики аудио
    const handleTimeUpdate = () => {
        if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
    };

    const togglePlay = useCallback(() => {
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
    }, [isPlaying]);

    const handlePrevious = useCallback(() => {
        if (!audioRef.current || !deck.sentences) return;
        
        const currentIndex = deck.sentences.findIndex(s => currentTime >= s.start && currentTime <= s.end);
        
        if (currentIndex === -1) return;
        
        if (currentTime - deck.sentences[currentIndex]?.start > 2) {
            audioRef.current.currentTime = deck.sentences[currentIndex].start;
        } else if (currentIndex > 0) {
            audioRef.current.currentTime = deck.sentences[currentIndex - 1].start;
        }
    }, [currentTime, deck.sentences]);

    // Переключение полноэкранного режима (логика YouTube)
    const toggleFullscreen = useCallback(async () => {
        if (!isFullscreen) {
            // ВХОД в полноэкранный (горизонтальный) режим
            try {
                // 1. Войти в полноэкранный режим
                await document.documentElement.requestFullscreen();
                
                // 2. Попытаться заблокировать ориентацию в горизонтальную
                if (screen.orientation && screen.orientation.lock) {
                    try {
                        await screen.orientation.lock('landscape');
                        setIsLandscapeForced(true);
                    } catch (lockError) {
                        console.log('Orientation lock not supported, using CSS fallback');
                        // CSS fallback будет применен через класс
                    }
                }
                
                setIsFullscreen(true);
                
                // 3. Если телефон вертикальный, применяем CSS трансформацию
                if (currentOrientation === 'portrait') {
                    containerRef.current?.classList.add('landscape-forced');
                }
                
            } catch (error) {
                console.error('Failed to enter fullscreen:', error);
                // Fallback: просто применяем CSS трансформацию
                containerRef.current?.classList.add('landscape-forced');
                setIsFullscreen(true);
            }
        } else {
            // ВЫХОД из полноэкранного режима
            try {
                // 1. Разблокировать ориентацию если была заблокирована
                if (screen.orientation && screen.orientation.unlock) {
                    await screen.orientation.unlock();
                }
                
                // 2. Выйти из полноэкранного режима
                if (document.exitFullscreen) {
                    await document.exitFullscreen();
                }
                
                // 3. Убрать CSS трансформацию
                containerRef.current?.classList.remove('landscape-forced');
                
                setIsFullscreen(false);
                setIsLandscapeForced(false);
                
            } catch (error) {
                console.error('Failed to exit fullscreen:', error);
                // Fallback: просто убираем CSS трансформацию
                containerRef.current?.classList.remove('landscape-forced');
                setIsFullscreen(false);
                setIsLandscapeForced(false);
            }
        }
    }, [isFullscreen, currentOrientation]);

    // Автоматический вход/выход при повороте телефона
    useEffect(() => {
        const handleOrientationChange = () => {
            const orientation = detectOrientation();
            
            if (orientation === 'landscape' && !isFullscreen) {
                // Телефон повернули горизонтально - автоматически в полноэкранный
                toggleFullscreen();
            } else if (orientation === 'portrait' && isFullscreen && !isLandscapeForced) {
                // Телефон повернули вертикально И ориентация не была принудительной
                toggleFullscreen();
            }
        };

        detectOrientation(); // начальное определение
        
        window.addEventListener('resize', handleOrientationChange);
        window.addEventListener('orientationchange', handleOrientationChange);
        
        return () => {
            window.removeEventListener('resize', handleOrientationChange);
            window.removeEventListener('orientationchange', handleOrientationChange);
        };
    }, [detectOrientation, isFullscreen, isLandscapeForced, toggleFullscreen]);

    // Слушатель полноэкранного режима
    useEffect(() => {
        const handleFullscreenChange = () => {
            const fullscreen = !!document.fullscreenElement;
            setIsFullscreen(fullscreen);
            
            if (!fullscreen) {
                // Выйдя из полноэкранного режима, убираем CSS трансформацию
                containerRef.current?.classList.remove('landscape-forced');
                setIsLandscapeForced(false);
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
        };
    }, []);

    // Управление контролами
    const handleScreenTouch = useCallback(() => {
        setShowControls(true);
        
        if (controlsTimeout.current) {
            clearTimeout(controlsTimeout.current);
        }
        
        controlsTimeout.current = setTimeout(() => {
            setShowControls(false);
        }, 3000);
    }, []);

    // Горячие клавиши
    useEffect(() => {
        const handleKeyPress = (e) => {
            if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                togglePlay();
            }
            if (e.key === 'ArrowLeft') handlePrevious();
            if (e.key === 'f' || e.key === 'F') toggleFullscreen();
            if (e.key === 'Escape' && isFullscreen) {
                toggleFullscreen();
            }
        };

        document.addEventListener('keydown', handleKeyPress);
        return () => document.removeEventListener('keydown', handleKeyPress);
    }, [togglePlay, handlePrevious, toggleFullscreen, isFullscreen]);

    // Очистка таймеров
    useEffect(() => {
        return () => {
            if (controlsTimeout.current) {
                clearTimeout(controlsTimeout.current);
            }
        };
    }, []);

    // Определяем, нужно ли применять горизонтальную ориентацию
    const shouldBeLandscape = isFullscreen || (currentOrientation === 'landscape' && !isFullscreen);

    return React.createElement("div", { 
        ref: containerRef,
        className: `fixed inset-0 bg-white flex flex-col z-60 overflow-hidden ${shouldBeLandscape ? 'player-landscape' : 'player-portrait'}`,
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
                className: "english-text font-normal leading-tight text-black mb-4"
            }, 
                currentSentence?.english || deck.deck_name
            ),
            
            // Русский текст
            React.createElement("div", { 
                className: "russian-text font-normal leading-relaxed text-gray-600"
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