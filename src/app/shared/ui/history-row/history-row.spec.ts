import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HistoryRow } from './history-row';

describe('HistoryRow', () => {
  let component: HistoryRow;
  let fixture: ComponentFixture<HistoryRow>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoryRow],
    }).compileComponents();

    fixture = TestBed.createComponent(HistoryRow);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
