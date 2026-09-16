import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WalletsModal } from './wallets-modal';

describe('WalletsModal', () => {
  let component: WalletsModal;
  let fixture: ComponentFixture<WalletsModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WalletsModal],
    }).compileComponents();

    fixture = TestBed.createComponent(WalletsModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
