import { SeatsScreen } from '../../../../../../components/v2/screens/seats/SeatsScreen';
import { previewOnly } from '../../../_preview/guard';
import { seatsPreview } from '../../../_preview/seats';

export default function SeatsPaidPreview() {
  previewOnly();
  return <SeatsScreen data={seatsPreview('/v2-preview/screens/seats/paid')} />;
}
