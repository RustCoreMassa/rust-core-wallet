import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RenameAccountModal } from './rename-account-modal';

describe('RenameAccountModal', () => {
  let component: RenameAccountModal;
  let fixture: ComponentFixture<RenameAccountModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RenameAccountModal],
    }).compileComponents();

    fixture = TestBed.createComponent(RenameAccountModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
