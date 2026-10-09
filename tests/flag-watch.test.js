// The flag and change watcher, connected to a stand-in variable service
// (src/chat/flag-watch.js).

const service = vi.hoisted(() => {
    const state = { values: {}, chatId: 'chat-1', read: new Set(), listeners: new Set(), watcherRefs: [] };
    return {
        state,
        onValuesChange: (listener) => {
            state.listeners.add(listener);
            return () => state.listeners.delete(listener);
        },
        getValue: (ref) => (ref in state.values ? { value: state.values[ref] } : undefined),
        targetOf: (ref) => ref,
        valuesChatId: () => state.chatId,
        wasRead: (ref) => state.read.has(ref),
        setWatcherRefs: (refs) => {
            state.watcherRefs = refs;
            return Promise.resolve();
        },
        // A refresh: these values were read for these refs.
        refresh(values, chatId = state.chatId) {
            state.values = values;
            state.chatId = chatId;
            state.read = new Set(state.watcherRefs);
            for (const listener of [...state.listeners]) listener();
        },
    };
});

vi.mock('../src/chat/variable-service.js', () => service);

const { onFlag, onChange, isFlagOn } = await import('../src/chat/flag-watch.js');

describe('flag-watch', () => {
    it('a listener hears a rise after the baseline, not the baseline itself', () => {
        const heard = [];
        const stop = onFlag('se__rain', (e) => heard.push(e));
        expect(service.state.watcherRefs).toEqual(['se__rain']);
        service.refresh({ se__rain: true }); // baseline: already raining when the chat opened
        expect(heard).toEqual([]);
        service.refresh({ se__rain: false });
        service.refresh({ se__rain: true });
        expect(heard.map((e) => [e.on, e.rose])).toEqual([[false, false], [true, true]]);
        stop();
        expect(service.state.watcherRefs).toEqual([]);
    });

    it('a value observed before it was first read does not look like a rise', () => {
        const heard = [];
        const stop = onFlag('se__snow', (e) => heard.push(e));
        // A refresh that ran before se__snow was added: not read for it.
        service.state.read = new Set();
        for (const listener of [...service.state.listeners]) listener();
        service.refresh({ se__snow: true }); // its first real read: the baseline
        expect(heard).toEqual([]);
        stop();
    });

    it('change listeners hear any value change; a chat switch is silent', () => {
        const heard = [];
        const stop = onChange('se__location', (e) => heard.push([e.previous, e.value]));
        service.refresh({ se__location: 'Gym' });
        service.refresh({ se__location: 'Lobby' });
        service.refresh({ se__location: 'Tavern' }, 'chat-2');
        expect(heard).toEqual([['Gym', 'Lobby']]);
        stop();
    });

    it('a failing listener does not stop the others', () => {
        const heard = [];
        const stopA = onFlag('se__fire', () => { throw new Error('boom'); });
        const stopB = onFlag('se__fire', (e) => heard.push(e.on));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        service.refresh({ se__fire: false });
        service.refresh({ se__fire: true });
        expect(heard).toEqual([true]);
        stopA();
        stopB();
    });

    it('isFlagOn reads the current value, and only a real true is on', () => {
        service.refresh({ se__x: true, se__y: 'true' });
        expect(isFlagOn('se__x')).toBe(true);
        expect(isFlagOn('se__y')).toBe(false);
        expect(isFlagOn('se__missing')).toBe(false);
    });

    it('bad arguments are ignored', () => {
        expect(typeof onFlag('', () => {})).toBe('function');
        expect(typeof onFlag('se__x', null)).toBe('function');
        expect(service.state.watcherRefs).toEqual([]);
    });
});
