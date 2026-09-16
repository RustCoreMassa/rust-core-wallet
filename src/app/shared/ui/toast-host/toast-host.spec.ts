import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToastHost } from './toast-host';

describe('ToastHost', () => {
  let component: ToastHost;
  let fixture: ComponentFixture<ToastHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToastHost],
    }).compileComponents();

    fixture = TestBed.createComponent(ToastHost);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
