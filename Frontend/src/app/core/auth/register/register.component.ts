import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  ActionButtonComponent,
  ActionConfig,
} from '../../../shared/components/action-button/action-button.component';
import { AuthService } from '../../services/auth.service';
import { TenantService } from '../../services/tenant.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ActionButtonComponent,
    RouterLink,
  ],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css',
})
export class RegisterComponent {
  protected readonly tenantService = inject(TenantService);

  signUpForm = new FormGroup(
    {
      fullName: new FormControl('', [Validators.required]),
      phoneNumber: new FormControl('', [
        Validators.required,
        Validators.pattern(/^0[237]\d{8}$/),
      ]),
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('', [
        Validators.required,
        Validators.minLength(8),
        Validators.maxLength(72),
        Validators.pattern(
          /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};":\\|,.<>/?]).*$/,
        ),
      ]),
      confirmPassword: new FormControl('', [Validators.required]),
    },
    { validators: this.passwordMatchValidator },
  );

  submitted = false;
  registrationError = '';
  registrationLoading = false;

  passwordVisible = false;
  confirmPasswordVisible = false;

  registerButtonConfig: ActionConfig = {
    label: 'Register',
    loadingLabel: 'Registering...',
    variant: 'primary',
    disabled: false,
  };

  constructor(
    private authService: AuthService,
    private router: Router,
  ) {}

  passwordMatchValidator(
    group: AbstractControl,
  ): { [key: string]: any } | null {
    const password = group.get('password');
    const confirmPassword = group.get('confirmPassword');
    if (
      password &&
      confirmPassword &&
      password.value !== confirmPassword.value
    ) {
      return { passwordMismatch: true };
    }
    return null;
  }

  get fullName() {
    return this.signUpForm.controls.fullName;
  }

  get email() {
    return this.signUpForm.controls.email;
  }

  get phoneNumber() {
    return this.signUpForm.controls.phoneNumber;
  }

  get password() {
    return this.signUpForm.controls.password;
  }

  get confirmPassword() {
    return this.signUpForm.controls.confirmPassword;
  }

  togglePasswordVisibility() {
    this.passwordVisible = !this.passwordVisible;
  }

  toggleConfirmPasswordVisibility() {
    this.confirmPasswordVisible = !this.confirmPasswordVisible;
  }

  onRegister() {
    if (this.registrationLoading) {
      return;
    }

    this.submitted = true;
    this.registrationError = '';

    if (!this.signUpForm.valid) {
      return;
    }

    this.registrationLoading = true;

    this.authService
      .register({
        fullName: this.fullName?.value || '',
        phoneNumber: this.phoneNumber?.value || '',
        email: this.email?.value || '',
        password: this.password?.value || '',
      })
      .subscribe({
        next: () => {
          this.registrationLoading = false;
          this.router.navigate(['/login']);
        },
        error: (error) => {
          this.registrationLoading = false;
          this.registrationError = error.message;
        },
      });
  }

  get registerActionConfig(): ActionConfig {
    return {
      ...this.registerButtonConfig,
      disabled: this.signUpForm.invalid || this.registrationLoading,
    };
  }

  protected readonly tenantStyles = computed((): Record<string, string> => {
    const config = this.tenantService.config();
    return {
      '--tenant-primary': config?.primaryColor || '#111827',
      '--tenant-secondary': config?.secondaryColor || '#374151',
      '--tenant-font': config?.fontFamily
        ? `'${config.fontFamily}', sans-serif`
        : 'inherit',
    };
  });
}
