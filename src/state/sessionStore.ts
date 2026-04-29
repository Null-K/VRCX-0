import { create } from 'zustand';

type SessionPhase = 'signed_out' | 'authenticating' | 'authenticated' | string;
type BootStatus = 'idle' | 'running' | 'completed' | 'error' | string;
type TransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | string;

interface SessionState {
    isLoggedIn: boolean;
    isFriendsLoaded: boolean;
    isFavoritesLoaded: boolean;
    databaseReady: boolean;
    sessionPhase: SessionPhase;
    bootStatus: BootStatus;
    transportStatus: TransportStatus;
    setSessionState: (patch: Partial<SessionSnapshot>) => void;
    resetSessionState: () => void;
    setLoggedIn: (value: unknown) => void;
    setFriendsLoaded: (value: unknown) => void;
    setFavoritesLoaded: (value: unknown) => void;
    setSessionPhase: (sessionPhase: SessionPhase) => void;
    setBootStatus: (bootStatus: BootStatus) => void;
    setTransportStatus: (transportStatus: TransportStatus) => void;
}

type SessionSnapshot = Pick<
    SessionState,
    | 'isLoggedIn'
    | 'isFriendsLoaded'
    | 'isFavoritesLoaded'
    | 'databaseReady'
    | 'sessionPhase'
    | 'bootStatus'
    | 'transportStatus'
>;

const initialState: SessionSnapshot = {
    isLoggedIn: false,
    isFriendsLoaded: false,
    isFavoritesLoaded: false,
    databaseReady: false,
    sessionPhase: 'signed_out',
    bootStatus: 'idle',
    transportStatus: 'disconnected'
};

export const useSessionStore = create<SessionState>((set) => ({
    ...initialState,
    setSessionState(patch) {
        set((state) => ({ ...state, ...patch }));
    },
    resetSessionState() {
        set(initialState);
    },
    setLoggedIn(value) {
        set({ isLoggedIn: Boolean(value) });
    },
    setFriendsLoaded(value) {
        set({ isFriendsLoaded: Boolean(value) });
    },
    setFavoritesLoaded(value) {
        set({ isFavoritesLoaded: Boolean(value) });
    },
    setSessionPhase(sessionPhase) {
        set({ sessionPhase });
    },
    setBootStatus(bootStatus) {
        set({ bootStatus });
    },
    setTransportStatus(transportStatus) {
        set({ transportStatus });
    }
}));
export type { BootStatus, SessionPhase, SessionState, TransportStatus };
