import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NftsPage } from './nfts-page';

describe('NftsPage', () => {
  let component: NftsPage;
  let fixture: ComponentFixture<NftsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NftsPage],
    }).compileComponents();

    fixture = TestBed.createComponent(NftsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
