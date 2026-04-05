using System;
using System.Windows.Forms;

namespace VRCX_0
{
    public class WinformBase : Form
    {
        protected override void OnHandleCreated(EventArgs e)
        {
            if (!DesignMode)
                WinformThemer.SetThemeToGlobal(this);
            base.OnHandleCreated(e);
        }
    }
}
