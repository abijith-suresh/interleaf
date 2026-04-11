export interface NoteRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  body: string;
  dayKey: string;
}

export type NoteInput = Pick<NoteRecord, "body"> & {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type NoteUpdate = Partial<Pick<NoteRecord, "body" | "updatedAt">>;
