import {
  Injectable,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse, HttpClient } from '@angular/common/http';
import { User } from '../models/user.model';
import {
  BehaviorSubject,
  MonoTypeOperatorFunction,
  catchError,
  throwError,
  Observable,
  map,
  tap,
} from 'rxjs';
import { environment } from '../../../environments/environment';
import { TenantService } from './tenant.service';
import { Router } from '@angular/router';

export interface AppointmentChangeRequest {
  id: string;
  type: 'CANCEL' | 'RESCHEDULE';
  requestedDate: string | null;
  requestedTime: string | null;
  reason: string | null;
}

export interface Appointment {
  id: string;
  status: string;
  date: string;
  serviceId: string;
  serviceName: string;
  hour: string;
  customerName?: string | null;
  barberId?: string | null;
  barberName?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  pendingRequest?: AppointmentChangeRequest | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private authUrl = `${environment.apiUrl}/auth`;

  constructor(
    private http: HttpClient,
    private tenantService: TenantService,
    private router: Router,
  ) {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const storedUser = localStorage.getItem(environment.CURRENT_USER_STORAGE);
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser) as User;
          if (this.isTokenValid(parsedUser)) {
            this.currentUserSubject.next(parsedUser);
          } else {
            this.logout();
          }
        } catch {
          this.logout();
        }
      }

      // Tenant isolation: a session belongs to the salon that issued it. Once
      // the current salon is known, drop a stored session from another salon.
      effect(() => {
        const tenantId = this.tenantService.config()?.tenantId;
        const user = this.currentUserSubject.value;
        if (tenantId && user?.tenantId && user.tenantId !== tenantId) {
          this.logout();
        }
      });
    }
  }

  get userRole() {
    return this.currentUserSubject.value?.type;
  }

  get userRoles(): string[] {
    const user = this.currentUserSubject.value;
    return user ? user.roles || [user.type] : [];
  }

  hasRole(role: string): boolean {
    const user = this.currentUserSubject.value;
    return !!user && (user.type === role || (user.roles || []).includes(role));
  }

  get currentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  private persistCurrentUser(user: User): void {
    localStorage.setItem(
      environment.CURRENT_USER_STORAGE,
      JSON.stringify(user),
    );
  }

  private throwApiError<T>(): MonoTypeOperatorFunction<T> {
    return catchError((error: unknown) => {
      const message =
        error instanceof HttpErrorResponse &&
        typeof error.error?.message === 'string'
          ? error.error.message
          : 'Server Error: Please try again later.';

      return throwError(() => new Error(message));
    });
  }

  register(userData: {
    fullName: string;
    email: string;
    password: string;
    phoneNumber?: string;
  }): Observable<boolean> {
    return this.http
      .post<any>(`${this.authUrl}/register`, userData, {
        headers: {
          'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
        },
      })
      .pipe(
        map((response) => !!response.success),
        this.throwApiError(),
      );
  }

  login(
    email: string,
    password: string,
  ): Observable<{ isTempPassword: boolean }> {
    return this.http
      .post<any>(
        `${this.authUrl}/login`,
        {
          email,
          password,
        },
        {
          headers: {
            'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
          },
        },
      )
      .pipe(
        tap((response) => {
          if (response.success) {
            const userWithToken: User = {
              id: response.payload.id,
              name: response.payload.fullName,
              email: response.payload.email,
              type: response.payload.role,
              roles: response.payload.roles || [response.payload.role],
              token: response.payload.token,
              password: '',
              tenantId: response.payload.shopSlug,
              phoneNumber: response.payload.phoneNumber,
              profileImageUrl: response.payload.profileImageUrl,
              profileImagePositionX: response.payload.profileImagePositionX,
              profileImagePositionY: response.payload.profileImagePositionY,
            };

            this.currentUserSubject.next(userWithToken);
            this.persistCurrentUser(userWithToken);
          }
        }),
        map((response) => ({
          isTempPassword: !!response.payload?.isTempPassword,
        })),
        this.throwApiError(),
      );
  }

  logout(): void {
    this.currentUserSubject.next(null);
    localStorage.removeItem(environment.CURRENT_USER_STORAGE);

    if (this.router.url !== '/login') {
      this.router.navigate(['/login']);
    }
  }

  requestPasswordReset(email: string): Observable<void> {
    return this.http
      .post<any>(
        `${this.authUrl}/forgot-password`,
        { email },
        {
          headers: {
            'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
          },
        },
      )
      .pipe(
        map(() => undefined),
        this.throwApiError(),
      );
  }

  verifyResetCode(email: string, code: string): Observable<string> {
    return this.http
      .post<any>(
        `${this.authUrl}/verify-reset-code`,
        { email, code },
        {
          headers: {
            'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
          },
        },
      )
      .pipe(
        map((response) => response.payload.resetToken as string),
        this.throwApiError(),
      );
  }

  resetPassword(
    email: string,
    resetToken: string,
    newPassword: string,
  ): Observable<void> {
    return this.http
      .post<any>(
        `${this.authUrl}/reset-password`,
        { email, resetToken, newPassword },
        {
          headers: {
            'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
          },
        },
      )
      .pipe(
        map(() => undefined),
        this.throwApiError(),
      );
  }

  updateProfile(profile: {
    fullName: string;
    email: string;
    phoneNumber: string;
    profileImageData: string | null;
    profileImagePositionX: number;
    profileImagePositionY: number;
  }): Observable<User> {
    return this.http
      .patch<any>(`${environment.apiUrl}/users/me`, profile, {
        headers: {
          'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
        },
      })
      .pipe(
        map((response) => {
          const updatedUser: User = {
            ...this.currentUserSubject.value!,
            name: response.payload.fullName,
            email: response.payload.email,
            phoneNumber: response.payload.phoneNumber,
            profileImageUrl: response.payload.profileImageUrl,
            profileImagePositionX: response.payload.profileImagePositionX,
            profileImagePositionY: response.payload.profileImagePositionY,
            type: response.payload.role,
            roles: response.payload.roles || [response.payload.role],
          };
          this.currentUserSubject.next(updatedUser);
          this.persistCurrentUser(updatedUser);
          return updatedUser;
        }),
        this.throwApiError(),
      );
  }

  deleteProfile(): Observable<void> {
    return this.http
      .delete(`${environment.apiUrl}/users/me`, {
        headers: {
          'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
        },
      })
      .pipe(
        map(() => undefined),
        this.throwApiError(),
      );
  }

  getMyAppointments(): Observable<Appointment[]> {
    return this.http
      .get<any>(`${environment.apiUrl}/appointments/mine`, {
        headers: {
          'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
        },
      })
      .pipe(
        map((response) => response.payload || []),
        this.throwApiError(),
      );
  }

  // Lets a barber reschedule an appointment or change its service.
  updateAppointmentDetails(
    id: string,
    details: { date: string; time: string; serviceId: string },
  ): Observable<Appointment> {
    return this.http
      .patch<any>(`${environment.apiUrl}/appointments/mine/${id}`, details, {
        headers: {
          'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
        },
      })
      .pipe(
        map((response) => response.payload as Appointment),
        this.throwApiError(),
      );
  }

  deleteAppointment(id: string): Observable<void> {
    return this.http
      .delete(`${environment.apiUrl}/appointments/mine/${id}`, {
        headers: {
          'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
        },
      })
      .pipe(
        map(() => undefined),
        this.throwApiError(),
      );
  }

  // Lets a customer request a cancellation; the barber approves/rejects it.
  requestAppointmentCancel(id: string, reason?: string): Observable<void> {
    return this.http
      .post(
        `${environment.apiUrl}/appointments/mine/${id}/cancel-request`,
        { reason },
        {
          headers: {
            'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
          },
        },
      )
      .pipe(
        map(() => undefined),
        this.throwApiError(),
      );
  }

  // Lets a customer propose a new date/time; the barber approves/rejects it.
  requestAppointmentReschedule(
    id: string,
    details: { date: string; time: string; reason?: string },
  ): Observable<void> {
    return this.http
      .post(
        `${environment.apiUrl}/appointments/mine/${id}/reschedule-request`,
        details,
        {
          headers: {
            'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
          },
        },
      )
      .pipe(
        map(() => undefined),
        this.throwApiError(),
      );
  }

  // Lets a barber approve or reject a customer's pending change request.
  resolveAppointmentRequest(
    requestId: string,
    action: 'APPROVE' | 'REJECT',
  ): Observable<void> {
    return this.http
      .patch(
        `${environment.apiUrl}/appointments/requests/${requestId}`,
        { action },
        {
          headers: {
            'X-Tenant-Slug': this.tenantService.config()?.tenantId || 'default',
          },
        },
      )
      .pipe(
        map(() => undefined),
        this.throwApiError(),
      );
  }

  private decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
      const base64Url = token.split('.')[1];
      if (!base64Url) {
        return null;
      }

      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(
        base64.length + ((4 - (base64.length % 4)) % 4),
        '=',
      );
      const decoded = atob(padded);
      const payload = decodeURIComponent(
        decoded
          .split('')
          .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
          .join(''),
      );

      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  isTokenValid(user: User | null): boolean {
    if (!user?.token) {
      return false;
    }

    const payload = this.decodeJwtPayload(user.token);
    const exp = payload?.['exp'];

    if (typeof exp !== 'number' || Number.isNaN(exp)) {
      return true;
    }

    return Math.floor(Date.now() / 1000) < exp;
  }
}
