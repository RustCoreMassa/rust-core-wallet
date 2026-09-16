import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StakingPage } from './staking-page';

describe('StakingPage', () => {
  let component: StakingPage;
  let fixture: ComponentFixture<StakingPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StakingPage],
    }).compileComponents();

    fixture = TestBed.createComponent(StakingPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
