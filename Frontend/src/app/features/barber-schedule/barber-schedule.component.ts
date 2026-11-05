import { Component, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { TenantService } from '../../core/services/tenant.service';
import { BarberService } from '../../core/services/barber.service';
import { AuthService } from '../../core/services/auth.service';
import { BarberService as ServiceOption } from '../../core/models/barber.model';
import {
  ScheduleDay,
  BlockedPeriod,
} from '../../core/models/barber-schedule.models';
import { WorkingHoursEditorComponent } from '../../shared/components/working-hours-editor/working-hours-editor.component';
import { BarberServicesManagerComponent } from '../../shared/components/barber-services-manager/barber-services-manager.component';
import { BlockedTimeManagerComponent } from '../../shared/components/blocked-time-manager/blocked-time-manager.component';

/**
 * Orchestrates the barber-only scheduling tools shown on the profile page:
 * working hours, custom services, and blocked time periods. All API calls
 * live here; each concern is rendered by a focused, reusable child:
 *  - app-working-hours-editor    -> weekly schedule toggles/times
 *  - app-barber-services-manager -> service list + "add service" form
 *  - app-blocked-time-manager    -> block/unblock time ranges
 */
@Component({
  selector: 'app-barber-schedule',
  standalone: true,
  imports: [
    WorkingHoursEditorComponent,
    BarberServicesManagerComponent,
    BlockedTimeManagerComponent,
  ],
  templateUrl: './barber-schedule.component.html',
  styleUrl: './barber-schedule.component.css',
})
export class BarberScheduleComponent {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);
  private readonly barberApi = inject(BarberService);
  private readonly auth = inject(AuthService);

  protected readonly saved = signal(false);
  protected readonly blockedPeriods = signal<BlockedPeriod[]>([]);
  protected readonly services = signal<ServiceOption[]>([]);
  protected error = '';

  protected readonly days = signal<ScheduleDay[]>([
    {
      weekday: 1,
      label: 'Monday',
      startTime: '09:00',
      endTime: '17:00',
      isActive: true,
    },
    {
      weekday: 2,
      label: 'Tuesday',
      startTime: '09:00',
      endTime: '17:00',
      isActive: true,
    },
    {
      weekday: 3,
      label: 'Wednesday',
      startTime: '09:00',
      endTime: '17:00',
      isActive: true,
    },
    {
      weekday: 4,
      label: 'Thursday',
      startTime: '09:00',
      endTime: '17:00',
      isActive: true,
    },
    {
      weekday: 5,
      label: 'Friday',
      startTime: '09:00',
      endTime: '17:00',
      isActive: true,
    },
    {
      weekday: 6,
      label: 'Saturday',
      startTime: '09:00',
      endTime: '14:00',
      isActive: false,
    },
    {
      weekday: 0,
      label: 'Sunday',
      startTime: '09:00',
      endTime: '14:00',
      isActive: false,
    },
  ]);

  // All requests are scoped to the active tenant via this header.
  private options() {
    return {
      headers: { 'X-Tenant-Slug': this.tenant.config()?.tenantId || 'default' },
    };
  }

  constructor() {
    // Only barbers (once the tenant config is available) need schedule/service data.
    effect(() => {
      // hasRole, not the primary type: owners/admins can also be barbers.
      if (this.tenant.config() && this.auth.hasRole('BARBER')) {
        this.loadSchedule();
        this.barberApi.listMyServices().subscribe({
          next: (services) => this.services.set(services),
          error: (error) =>
            (this.error = this.apiMessage(error, 'Could not load services.')),
        });
      }
    });
  }

  private apiMessage(error: any, fallback: string): string {
    return error.error?.message || error.message || fallback;
  }

  private loadSchedule(): void {
    if (!this.tenant.config()) return;
    this.http
      .get<any>(`${environment.apiUrl}/public/schedule`, this.options())
      .subscribe({
        next: (response) => {
          const current = response.payload.hours;
          this.days.update((days) =>
            days.map(
              (day) =>
                current.find((item: any) => item.weekday === day.weekday) ||
                day,
            ),
          );
          this.blockedPeriods.set(response.payload.blockedPeriods);
        },
        error: (error) =>
          (this.error = this.apiMessage(
            error,
            'Could not load your schedule. Apply the barber scheduling migrations first.',
          )),
      });
  }

  // Called by app-working-hours-editor whenever a day's toggle/time changes.
  protected updateDay(
    day: ScheduleDay,
    field: keyof ScheduleDay,
    value: string | boolean,
  ): void {
    this.days.update((days) =>
      days.map((item) => (item === day ? { ...item, [field]: value } : item)),
    );
    this.saved.set(false);
  }

  // Called by app-working-hours-editor's "Save working hours" button.
  protected saveSchedule(): void {
    this.http
      .put(
        `${environment.apiUrl}/public/schedule`,
        { hours: this.days() },
        this.options(),
      )
      .subscribe({
        next: () => {
          this.saved.set(true);
          this.error = '';
        },
        error: (error) =>
          (this.error = this.apiMessage(
            error,
            'Could not save working hours.',
          )),
      });
  }

  // Called by app-barber-services-manager when a new service is submitted.
  protected addService(value: {
    name: string;
    durationMinutes: number;
    price: number;
  }): void {
    this.barberApi.createService(value).subscribe({
      next: (service) => {
        this.services.update((services) => [...services, service]);
        this.error = '';
      },
      error: (error) =>
        (this.error = this.apiMessage(
          error,
          'Could not create service. Apply the barber services migration first.',
        )),
    });
  }

  // Called by app-barber-services-manager when a barber saves an edit.
  protected updateService(value: {
    id: string;
    name: string;
    durationMinutes: number;
    price: number;
  }): void {
    const { id, ...body } = value;
    this.barberApi.updateService(id, body).subscribe({
      next: (service) => {
        this.services.update((services) =>
          services.map((item) => (item.id === id ? service : item)),
        );
        this.error = '';
      },
      error: (error) =>
        (this.error = this.apiMessage(error, 'Could not update this service.')),
    });
  }

  // Called by app-barber-services-manager's "Delete" confirmation.
  protected deleteService(id: string): void {
    this.barberApi.deleteService(id).subscribe({
      next: () => {
        this.services.update((services) =>
          services.filter((item) => item.id !== id),
        );
        this.error = '';
      },
      error: (error) =>
        (this.error = this.apiMessage(error, 'Could not delete this service.')),
    });
  }

  // Called by app-blocked-time-manager when a new blocked period is submitted.
  protected blockTime(value: {
    startsAt: string;
    endsAt: string;
    reason: string;
  }): void {
    this.http
      .post<{
        payload: BlockedPeriod;
      }>(`${environment.apiUrl}/public/schedule/blocked`, value, this.options())
      .subscribe({
        next: (response) => {
          this.blockedPeriods.update((periods) => [
            ...periods,
            response.payload,
          ]);
          this.error = '';
        },
        error: (error) =>
          (this.error = error.error?.message || 'Could not block this time.'),
      });
  }

  // Called by app-blocked-time-manager's "Remove" button.
  protected unblockTime(id: string): void {
    this.http
      .delete(
        `${environment.apiUrl}/public/schedule/blocked/${id}`,
        this.options(),
      )
      .subscribe({
        next: () =>
          this.blockedPeriods.update((periods) =>
            periods.filter((period) => period.id !== id),
          ),
        error: (error) =>
          (this.error = this.apiMessage(
            error,
            'Could not remove this blocked period.',
          )),
      });
  }

  // Called by app-blocked-time-manager when a barber saves an inline edit.
  protected editBlockedTime(value: {
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string;
  }): void {
    const { id, ...body } = value;
    this.http
      .patch<{
        payload: BlockedPeriod;
      }>(
        `${environment.apiUrl}/public/schedule/blocked/${id}`,
        body,
        this.options(),
      )
      .subscribe({
        next: (response) => {
          this.blockedPeriods.update((periods) =>
            periods.map((period) =>
              period.id === id ? response.payload : period,
            ),
          );
          this.error = '';
        },
        error: (error) =>
          (this.error = this.apiMessage(
            error,
            'Could not update this blocked period.',
          )),
      });
  }
}
