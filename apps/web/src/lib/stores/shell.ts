import { create } from "zustand";

type ShellState = {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
};

export const useShellStore = create<ShellState>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
