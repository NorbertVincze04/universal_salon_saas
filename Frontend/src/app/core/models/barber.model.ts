export interface Barber {
  id: string;
  name: string;
  email?: string;
  phoneNumber: string | null;
  profileImageUrl: string | null;
  profileImagePositionX: number;
  profileImagePositionY: number;
  role?: string;
  roles?: string[];
  rating?: number | null;
  ratingCount?: number;
}

export interface BarberService {
  id: string;
  name: string;
  durationMinutes: number;
  price: string;
}

export interface BarberAvailability {
  barber: Barber;
  service: BarberService;
  slots: string[];
}

export interface MyBarberRating {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface BarberReceivedRating {
  id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  rating: number;
  comment: string;
  date: string;
}

export interface BarberGalleryPhoto {
  id: string;
  imageUrl: string;
  imagePositionX: number;
  imagePositionY: number;
  caption: string | null;
  displayOrder: number;
  createdAt: string;
}

export interface MyBarberRatingStatus {
  rating: MyBarberRating | null;
  eligible: boolean;
  canRate: boolean;
  nextEligibleDate: string | null;
}
