import { DeleteScreen } from '../../../../../../components/v2/screens/settings/DeleteScreen';
import { previewOnly } from '../../../_preview/guard';
import { deletePreview } from '../../../_preview/screens';

export default function DeletePreview() {
  previewOnly();
  return <DeleteScreen data={deletePreview()} />;
}
