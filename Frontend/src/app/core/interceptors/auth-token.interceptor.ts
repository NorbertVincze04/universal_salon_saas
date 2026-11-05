import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthTokenInterceptor implements HttpInterceptor {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly authService = inject(AuthService);

  intercept(
    req: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    // Only our own API gets tenant headers and the bearer token; never leak
    // the token to third-party URLs (fonts, maps, static JSON, ...).
    if (!this.isBrowser || !this.isApiRequest(req.url)) {
      return next.handle(req);
    }

    // Bind every API call to the salon whose domain the visitor is on, so a
    // request can never silently target another tenant (e.g. the 'default'
    // fallback slug when the tenant config failed to load).
    const headers: Record<string, string> = {};
    if (!req.headers.has('X-Tenant-Domain')) {
      headers['X-Tenant-Domain'] = window.location.hostname;
    }

    const token = this.readToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const apiReq = req.clone({ setHeaders: headers });
    if (!token) {
      return next.handle(apiReq);
    }

    return next.handle(apiReq).pipe(
      catchError((error: HttpErrorResponse) => {
        // 401 = the session is invalid (expired, revoked, other salon).
        // 403 only means "not allowed to do this" and must not log out.
        if (error.status === 401) {
          this.authService.logout();
        }
        return throwError(() => error);
      }),
    );
  }

  private isApiRequest(url: string): boolean {
    return url === environment.apiUrl || url.startsWith(`${environment.apiUrl}/`);
  }

  private readToken(): string | null {
    try {
      const rawUser = localStorage.getItem(environment.CURRENT_USER_STORAGE);
      if (!rawUser) return null;
      const user = JSON.parse(rawUser) as { token?: unknown };
      return typeof user.token === 'string' && user.token ? user.token : null;
    } catch {
      return null;
    }
  }
}
