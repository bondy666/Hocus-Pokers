import { createContext, useContext } from "react";
import {
  members as seedMembers,
  tournaments as seedTournaments,
  type Member,
  type Tournament,
} from "./data.ts";
import type { CurrentUser } from "./api.ts";

export interface ClubContextValue {
  members: Member[];
  tournaments: Tournament[];
  source: "api" | "seed";
  user: CurrentUser | null;
  authChecked: boolean;
  refresh: () => Promise<void>;
}

export const ClubContext = createContext<ClubContextValue>({
  members: seedMembers,
  tournaments: seedTournaments,
  source: "seed",
  user: null,
  authChecked: false,
  refresh: async () => {},
});

export const useClub = (): ClubContextValue => useContext(ClubContext);
