export type BriefSlot = 'origin' | 'destination' | 'startDate' | 'durationDays' | 'adults' |
  'budgetPerPersonCny' | 'interests' | 'pace' | 'lodgingPreferences' |
  'dietaryRestrictions' | 'mobilityRestrictions';

export interface TripBrief {
  origin?: string;
  destination?: string;
  startDate?: string;
  durationDays?: number;
  adults?: number;
  budgetPerPersonCny?: number;
  interests?: string;
  pace?: string;
  lodgingPreferences?: string;
  dietaryRestrictions?: string;
  mobilityRestrictions?: string;
}

export interface TripSession {
  id: string;
  title: string;
  conversationId: number;
  planningTaskId?: number;
  planningStep?: 'queued' | 'searching' | 'ranking' | 'routing' | 'validating';
  status: 'collecting' | 'confirming' | 'planning' | 'ready' | 'failed' | 'archived';
  brief: TripBrief;
  messages: ChatMessage[];
  deliveries: ItineraryDelivery[];
  createdAt: string;
  updatedAt: string;
  trashedAt?: string;
  archivedAt?: string;
  statusBeforeArchive?: Exclude<TripSession['status'], 'archived'>;
  processedRequests?: Record<string, string>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  deliveryVersion?: number;
}

export interface ItineraryItem {
  id: string;
  name: string;
  type: 'attraction' | 'food' | 'hotel' | 'transport';
  startTime: string;
  durationMinutes: number;
  /** null means no trustworthy price is available; it must not be shown as free. */
  estimatedCostCny: number | null;
  coordinates: [number, number] | null;
  sourceUrl: string;
  tips: string;
  imageUrl: string;
  bookingUrl: string;
  factIds?: string[];
}

export interface RouteLeg {
  fromItemId: string;
  toItemId: string;
  mode: 'walk' | 'drive' | 'transit';
  durationMinutes: number;
  distanceMeters: number;
  path: [number, number][];
}

export interface ItineraryDay {
  date: string;
  dayNumber: number;
  title: string;
  items: ItineraryItem[];
  route: RouteLeg[];
}

export interface ItineraryDelivery {
  id: string;
  tripSessionId: string;
  version: number;
  status: 'draft' | 'ready';
  city: string;
  durationDays: number;
  estimatedTotalCny: number;
  budgetTotalCny: number;
  generatedAt: string;
  days: ItineraryDay[];
  warnings: string[];
  bookingActions?: BookingAction[];
  facts?: ResearchFact[];
  budgetSummary?: { knownTotalCny: number; unknownItemCount: number; complete: boolean };
}

export interface ResearchFact {
  id: string;
  field: 'name' | 'address' | 'coordinates' | 'photo' | 'openingHours' | 'ticketPrice' | 'reservation';
  value: string;
  sourceUrl: string;
  sourceTitle: string;
  retrievedAt: string;
  confidence: 'verified' | 'probable' | 'unverified';
  provider: string;
}

export interface BookingAction {
  kind: 'flight' | 'rail' | 'hotel';
  label: string;
  url: string;
  criteria: string;
}
