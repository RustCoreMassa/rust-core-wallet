import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BackupPhraseModal } from './backup-phrase-modal';

describe('BackupPhraseModal', () => {
  let component: BackupPhraseModal;
  let fixture: ComponentFixture<BackupPhraseModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BackupPhraseModal],
    }).compileComponents();

    fixture = TestBed.createComponent(BackupPhraseModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
