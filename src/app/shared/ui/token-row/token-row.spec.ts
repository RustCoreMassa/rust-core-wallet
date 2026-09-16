import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TokenRow } from './token-row';

describe('TokenRow', () => {
  let component: TokenRow;
  let fixture: ComponentFixture<TokenRow>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TokenRow],
    }).compileComponents();

    fixture = TestBed.createComponent(TokenRow);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
