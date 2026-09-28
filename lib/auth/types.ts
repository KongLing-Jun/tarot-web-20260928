export interface CurrentUser {
  isGuest?: boolean;
  nickname: string;
  avatarUrl: string;
  createdAt: string;
  readingCount: number;
  creditBalance: number;
  favoriteCardIds: string[];
}
